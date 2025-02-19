import { Pool } from 'pg';
import dotenv from 'dotenv';
import socketIo, { Server, Socket } from 'socket.io';

// Load environment variables
dotenv.config();

// Create a new pool with the database connection string from the environment
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export default class User {
    username: string;
    bal: number;
    databaseId: string;
    allIn: boolean = false;
    currentBet: number = 0;
    folded: boolean = false;
    currentPotStake: number = 0;
    cards: string[] = [];
    ws: Socket;
    winnings: number = 0;

    constructor(username: string, bal: number, databaseId: string, webSocket: Socket) {
        this.username = username;
        this.bal = bal;
        this.databaseId = databaseId;
        this.ws = webSocket;
    }

    // Synchronize balance with the database
    async syncBal(): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query(
                'UPDATE userdata SET cents = $1 WHERE id = $2',
                [this.bal, this.databaseId]
            );
        } catch (error) {
            console.error('Error updating user balance in the database:', error);
        } finally {
            // Release the client back to the pool
            client.release();
        }
    }

    getDataObject() {
        return {
            username: this.username,
            bal: this.bal,
            databaseId: this.databaseId,
            allIn: this.allIn,
            folded: this.folded,
            currentBet: this.currentBet,
        }
    }

    getDataObjectWithCards() {
        return {
            username: this.username,
            bal: this.bal,
            databaseId: this.databaseId,
            allIn: this.allIn,
            folded: this.folded,
            currentBet: this.currentBet,
            cards: this.cards
        }
    }
}