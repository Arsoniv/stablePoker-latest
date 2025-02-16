const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const {User} = require('./User')
const Round = require("./Round");

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server);


const table = {
    users: [],
    round: {},
    maxPlayers: 6,
    smallBlind: 1,
    bigBlind: 2,
    roundInPlay: false,
}

const attemptToStartARound = () => {
    let qualifyedUsers = [];

    table.users.forEach((user) => {
        if (user.bal >= table.bigBlind + table.smallBlind) {
            qualifyedUsers.push(user);
        }
    })

    if (qualifyedUsers.length >= 2) {
        table.roundInPlay = true;
        table.round = new Round(qualifyedUsers, table.smallBlind, table.bigBlind, io);
    }
}


io.on('connection', async (socket) => {

    const token = socket.handshake.auth.token;
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
                socket,
            );

            table.users.push(newUser);

            const playerId = response.rows[0].id;

            socket.on('fold', () => {
                const round = table.round;
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
                const round = table.round;
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

            socket.on('raise', ({ raiseAmount }) => {
                const round = table.round;
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
                const round = table.round;
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
                    table.round.players.splice(playerIndex, 1);
                    console.log(`Removed player ${playerId} from the round.`);
                    table.round.nextPlayer();
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
