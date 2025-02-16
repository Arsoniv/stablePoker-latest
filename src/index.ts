import express from 'express';
import http from 'http';
import socketIo, { Server, Socket } from 'socket.io';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import User from './User';
import Round from './Round';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const app = express();
const server = http.createServer(app);
const io: Server = new Server(server);

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

const attemptToStartARound = () => {
    let qualifiedUsers: User[] = [];

    table.users.forEach((user) => {
        if (user.bal >= table.bigBlind + table.smallBlind) {
            qualifiedUsers.push(user);
        }
    });

    if (qualifiedUsers.length >= 2) {
        table.roundInPlay = true;
        table.round = new Round(qualifiedUsers, table.smallBlind, table.bigBlind, io, () => {
            table.users[table.users.length];
        });
    }
};

io.on('connection', async (socket: Socket) => {
    const token: string = socket.handshake.auth.token;
    console.log('User connecting with token:', token);

    const client = await pool.connect();

    try {
        const response = await client.query(
            'SELECT * FROM userdata WHERE token = $1',
            [token]
        );

        if (response.rows.length > 0) {
            console.log('User authenticated:', response.rows[0]);

            const newUser = new User(
                response.rows[0].username,
                response.rows[0].cents,
                response.rows[0].id,
                socket
            );

            table.users.push(newUser);

            const playerId = response.rows[0].id;

            socket.on('fold', () => {
                const round = table.round as Round;
                if (round) {
                    if (round.players[round.actionIndex].databaseId === playerId) {
                        round.fold();
                    } else {
                        console.log('Round found, but it is not your turn');
                    }
                } else {
                    console.log('No active round in session');
                }
            });

            socket.on('check', () => {
                const round = table.round as Round;
                if (round) {
                    if (round.players[round.actionIndex].databaseId === playerId) {
                        round.check();
                    } else {
                        console.log('Round found, but it is not your turn');
                    }
                } else {
                    console.log('No active round in session');
                }
            });

            socket.on('raise', ({ raiseAmount }: { raiseAmount: number }) => {
                const round = table.round as Round;
                if (round) {
                    if (round.players[round.actionIndex].databaseId === playerId) {
                        round.raise(raiseAmount);
                    } else {
                        console.log('Round found, but it is not your turn');
                    }
                } else {
                    console.log('No active round in session');
                }
            });

            socket.on('call', () => {
                const round = table.round as Round;
                if (round) {
                    if (round.players[round.actionIndex].databaseId === playerId) {
                        round.call();
                    } else {
                        console.log('Round found, but it is not your turn');
                    }
                } else {
                    console.log('No active round in session');
                }
            });

            socket.on('balCheck', () => {
                const user = table.users.find(user => user.databaseId === playerId);
                if (user) {
                    socket.emit('bal', { bal: user.bal });
                } else {
                    socket.emit('balError', { message: 'User not found' });
                }
            });

            socket.on('disconnect', () => {
                console.log('User disconnected');

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

server.listen(3000, () => {
    console.log('Server is running on port 3000');
});
