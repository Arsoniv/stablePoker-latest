import {Pool} from "pg";

const dotenv = require('dotenv');

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export default class User {
    username;
    bal;
    databaseId;
    allIn = false
    currentBet = 0;
    folded = false;
    currentPotStake = 0;
    cards = [];
    ws;

    constructor(username,bal,databaseId, webSocket) {
        this.username = username;
        this.bal = bal;
        this.databaseId = databaseId;
        this.ws = webSocket;
    }

    async syncBal() {
        const client = await pool.connect();
        await client.query(
            'UPDATE userdata SET cents = $1 WHERE id = $2',
            [this.bal, this.databaseId]
        )
    }

}