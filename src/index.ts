import { Server, Socket } from 'socket.io';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import User from './User';
import Round from './Round';
import { createServer } from 'http';
import express from 'express';
import {EventEmitter} from 'events'

const emitter = new EventEmitter();

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const app = express();
const server = createServer(app); // Create an HTTP server

const server1 = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Interface for the game table state
interface Table {
    users: User[];
    round: Round | null;
    maxPlayers: number;
    smallBlind: number;
    bigBlind: number;
    roundInPlay: boolean;
}

const table: Table = {
    users: [],
    round: null,
    maxPlayers: 6,
    smallBlind: 1,
    bigBlind: 2,
    roundInPlay: false,
};

const getAllUserData = (): { username: string; bal: number; databaseId: string; allIn: boolean; folded: boolean; currentBet: number}[] => {
    let arr:{ username: string; bal: number; databaseId: string; allIn: boolean; folded: boolean; currentBet: number}[] = []

    table.users.forEach(user => {
        arr.push(user.getDataObject());
    })
    return arr;
}

emitter.on('sendTableData', () => {
    console.log('sendTableData');
    server1.emit('tableUserInfo', getAllUserData());
})

// Function to attempt to start a new round of the game
const attemptToStartARound = () => {
    let qualifiedUsers: User[] = [];

    table.users.forEach((user) => {
        if (user.bal >= table.bigBlind + table.smallBlind) {
            qualifiedUsers.push(user);
        }
    });

    if (qualifiedUsers.length >= 2 && !table.roundInPlay) {
        table.roundInPlay = true;
        table.round = new Round(qualifiedUsers, table.bigBlind, table.smallBlind, server1, () => {
            console.log('end round callback')
            table.round = null;
            table.roundInPlay = false;
            table.users.push(table.users.shift()!);
            server1.emit('tableUserInfo', getAllUserData());
            server1.emit('timeToNextRound', 5000);
            setTimeout(attemptToStartARound, 5000);
        }, emitter)
    }
};

// Handle incoming connections
server1.on('connection', async (socket: Socket) => {
    const token: string = socket.handshake.auth.token;
    console.log('User connecting with token:', token);

    const client = await pool.connect();

    try {
        // Check if the user exists in the database
        const response = await client.query(
            'SELECT * FROM userdata WHERE token = $1',
            [token]
        );

        if (response.rows.length > 0) {
            console.log('User authenticated:', response.rows[0]);

            if (table.users.some((user) => {
                if (user.databaseId === response.rows[0].id) return true;
            })){
                console.log('User tried to connect on an already connected account')
                socket.disconnect();
                return;
            }

            const newUser = new User(
                response.rows[0].username,
                response.rows[0].cents,
                response.rows[0].id,
                socket
            );

            const id = table.users.push(newUser)- 1;

            const playerId = response.rows[0].id;

            socket.emit('bal', { bal: newUser.bal });
            socket.emit('username', { username: newUser.username, id: id });

            server1.emit('tableUserInfo', getAllUserData())

            // Handle player actions (fold, check, raise, call)
            socket.on('fold', () => {
                const round = table.round as Round;
                if (round && round.players[round.actionIndex].databaseId === playerId) {
                    round.fold();
                } else {
                    console.log('Round found, but it is not your turn');
                }
            });

            socket.on('check', () => {
                const round = table.round as Round;
                if (round && round.players[round.actionIndex].databaseId === playerId) {
                    round.check();
                } else {
                    console.log('Round found, but it is not your turn');
                }
            });

            socket.on('raise', ({ raiseAmount }: { raiseAmount: number }) => {
                const round = table.round as Round;
                if (round && round.players[round.actionIndex].databaseId === playerId) {
                    round.raise(raiseAmount);
                } else {
                    console.log('Round found, but it is not your turn');
                }
            });

            socket.on('call', () => {
                const round = table.round as Round;
                if (round && round.players[round.actionIndex].databaseId === playerId) {
                    round.call();
                } else {
                    console.log('Round found, but it is not your turn');
                }
            });

            // Handle balance check
            socket.on('balCheck', () => {
                const user = table.users.find(user => user.databaseId === playerId);
                if (user) {
                    console.log('bal request received')
                    socket.emit('bal', { bal: user.bal });
                } else {
                    socket.emit('balError', { message: 'User not found' });
                }
            });

            // Handle disconnection
            socket.on('disconnect', () => {
                console.log('User disconnected');


                table.users.forEach((user: User, index: number) => {
                    if (user.databaseId === playerId) {
                        table.users.splice(index, 1);
                    }
                })

                if (!table.round) {
                    console.log('No active round, skipping player removal');
                    return;
                }

                const playerIndex = table.round.players.findIndex(player => player.databaseId === playerId);

                if (playerIndex !== -1) {
                    (table.round as Round).players.splice(playerIndex, 1);
                    console.log(`Removed player ${playerId} from the round.`);
                    (table.round as Round).nextPlayer();
                }
            });
            server1.emit('timeToNextRound', 5000);
            setTimeout(attemptToStartARound, 5000);
        } else {
            console.log('Authentication failed. Disconnecting socket.');
            socket.disconnect(true);
        }
    } catch (error) {
        console.error('Error querying the database:', error);
    } finally {
        client.release();
    }
});


server.listen(8080, () => {
    console.log('Listening on port 8080');
})