import User from './User'; // Assuming User class exists and is correctly typed
import { Server } from 'socket.io';
import evalHand from "./evaluator";
import {EventEmitter} from "events";

export default class Round {
    pot = 0;
    players: User[] = [];
    currentBet = 0;
    newMoneyIn = 0;
    actionIndex = 0;
    mostRecentHappyIndex = 0;
    communityCards: string[] = [];
    cardsDealt: string[] = [];
    bigBlind: number;
    smallBlind: number;
    roundEnded = false;
    wss: Server;
    endOfRoundCallback: () => void;
    stage = 1;
    eventEmitter: EventEmitter;

    constructor(players: User[], bigBlind: number, smallBlind: number, webSocketServer: Server, callback: () => void, eventEmitter: EventEmitter) {
        this.players = players;
        this.bigBlind = bigBlind;
        this.smallBlind = smallBlind;
        this.wss = webSocketServer;
        this.endOfRoundCallback = callback;
        this.eventEmitter = eventEmitter;

        this.wss.emit('roundStart');
        this.wss.emit('roundInfo', this.getRoundInfo());

        this.payBlindsDealCardsAndStartRound();
    }

    getRoundInfo(): any {
        let playerArr: any = [];
        this.players.forEach((player) => {
            playerArr.push(player.getDataObject());
        })
        return {
            players: playerArr,
            pot: this.pot,
            smallBlind: this.smallBlind,
            bigBlind: this.bigBlind,
            stage: this.stage,
            communityCards: this.communityCards,
            mostRecentHappyIndex: this.mostRecentHappyIndex,
            actionIndex: this.actionIndex,
            roundEnded: this.roundEnded,
            newMoneyIn: this.newMoneyIn,
            currentBet: this.currentBet
        }
    }

    sendInfoToPlayers() {
        this.eventEmitter.emit('sendTableData');
        this.players.forEach(player => {
            player.ws.emit('roundInfo', this.getRoundInfo());
        })
        this.players.forEach(player => {
            console.log(player.bal);
            player.ws.emit('bal', {bal: player.bal});
        })
    }

    randomCard(): string {
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 't', 'j', 'q', 'k', 'a'];
        const suits = ['d', 'c', 'h', 's'];

        // Check if all cards have been dealt.
        if (this.cardsDealt.length >= 52) {
            throw new Error("All cards have been dealt");
        }

        let card;
        do {
            const rank = ranks[Math.floor(Math.random() * ranks.length)];
            const suit = suits[Math.floor(Math.random() * suits.length)];
            card = rank + suit;
        } while (this.cardsDealt.includes(card));

        this.cardsDealt.push(card);
        return card;
    }

    payBlindsDealCardsAndStartRound(): void {
        this.players[0].bal -= this.smallBlind;
        this.newMoneyIn += this.smallBlind;
        this.players[0].currentBet += this.smallBlind;
        this.players[0].currentPotStake += this.smallBlind;
        this.players[0].syncBal();

        this.players[1].bal -= this.bigBlind;
        this.currentBet = this.bigBlind;
        this.newMoneyIn += this.bigBlind;
        this.players[1].currentBet += this.bigBlind;
        this.players[1].currentPotStake += this.bigBlind;
        this.players[1].syncBal();
        if (this.players[2]) {
            this.mostRecentHappyIndex = 2;
        }else {
            this.mostRecentHappyIndex = 0;
        }

        this.actionIndex = 1;

        this.dealAllHands();

        this.nextPlayer(false);
    }

    dealAllHands() {
        this.players.forEach(player => {
            player.cards.splice(0)
            player.cards.push(this.randomCard());
            player.cards.push(this.randomCard());
            player.ws.emit('holeCards', player.cards);
        })
    }

    nextPlayer(careAboutLastHappyIndex: boolean = true): void {
        console.log('nextPlayer');

        const prevActionIndex = this.actionIndex;
        let suitablePlayers = 0;
        let nonAllInPlayers = 0;

        this.players.forEach((player) => {
            if (!player.folded) {
                suitablePlayers++;
                if (!player.allIn) nonAllInPlayers++;
            }
        });

        if (suitablePlayers <= 1) {
            this.endRound();
            return;
        }

        if (nonAllInPlayers <= 1) {
            console.log('Only one non-all-in player remains, fast-forwarding stages.');
            while (this.stage < 5) {
                this.endStage();
            }
            return;
        }

        let foundPlayer = false;
        let iterations = 0;
        while (!foundPlayer && iterations <= 1000) {
            this.actionIndex++;
            if (this.actionIndex >= this.players.length) {
                this.actionIndex = 0;
            }
            if (!this.players[this.actionIndex].allIn && !this.players[this.actionIndex].folded && this.actionIndex !== prevActionIndex) {
                foundPlayer = true;
            }
            iterations++;
        }

        if (iterations > 1000) {
            console.log('Could not find a suitable player');
            this.endRound();
            return;
        }

        if (this.actionIndex === this.mostRecentHappyIndex && careAboutLastHappyIndex) {
            this.endStage();
        }
        this.sendInfoToPlayers();
    }

    endRound(): void {
        console.log(`end round`)

        this.roundEnded = true;
        const winners: any[] = this.solveHandsAndGivePeoplePot();

        this.wss.emit('roundEnd', {
            winners: winners
        });

        this.endOfRoundCallback();
    }

    endStage(): void {
        console.log('nextStage');
        this.currentBet = 0;
        this.mostRecentHappyIndex = 0;
        this.actionIndex = 0;

        this.pot += this.newMoneyIn;
        this.newMoneyIn = 0;
        this.players.forEach(player => {
            player.currentBet = 0;
        });
        this.stage++;

        // Deal community cards for each stage
        if (this.stage === 2) { // post flop
            this.communityCards.push(this.randomCard(), this.randomCard(), this.randomCard());
        } else if (this.stage === 3) { // post turn
            this.communityCards.push(this.randomCard());
        } else if (this.stage === 4) { // post river
            this.communityCards.push(this.randomCard());
        } else if (this.stage === 5) { // post round
            this.endRound();
            return;
        }

        // If only one non-all-in player remains, fast-forward to showdown
        let nonAllInPlayers = this.players.filter(player => !player.folded && !player.allIn).length;
        if (nonAllInPlayers <= 1 && this.stage < 5) {
            while (this.stage < 5) {
                this.endStage();
            }
            return;
        }

        this.sendInfoToPlayers();
    }

    raise(amount: number): void {
        const player = this.players[this.actionIndex];

        // Calculate the amount needed to match the current bet first
        const callAmount = this.currentBet - player.currentBet;
        const totalRequired = callAmount + amount;

        if (player.bal >= totalRequired) {
            this.mostRecentHappyIndex = this.actionIndex;

            // Increase the table's current bet by the raise amount
            this.currentBet += amount;

            // The total amount the player is putting in
            const putIn = callAmount + amount;
            this.newMoneyIn += putIn;
            player.currentPotStake += putIn;
            player.currentBet += amount;

            // Deduct from the player's balance
            player.bal -= putIn;

            if (player.bal === 0) {
                player.allIn = true;
            }

            this.wss.emit('action', { type: 'raise', index: this.actionIndex, amount: amount });
            player.syncBal();
            this.nextPlayer();
        } else {
            // If the player cannot afford a raise, they automatically call
            this.call();
        }
    }

    call(): void {
        const player = this.players[this.actionIndex];
        const callAmount = this.currentBet - player.currentBet;

        if (callAmount <= 0) {
            this.check();
        } else {
            if (player.bal >= callAmount) {
                this.newMoneyIn += callAmount;
                player.bal -= callAmount;
                player.currentBet = this.currentBet;
                player.currentPotStake += callAmount;

                this.wss.emit('action', { type: 'call', index: this.actionIndex, allIn: false });
                player.syncBal();
                this.nextPlayer();
            } else {
                // Player goes all-in with the remaining balance
                this.newMoneyIn += player.bal;
                player.currentPotStake += player.bal; // Ensure stake is updated BEFORE balance goes to zero
                player.currentBet += player.bal;
                player.bal = 0;
                player.allIn = true;

                this.wss.emit('action', { type: 'call', index: this.actionIndex, allIn: true });
                player.syncBal();
                this.nextPlayer();
            }
        }
    }

    check(): void {
        const player = this.players[this.actionIndex];
        // If the player's current bet already matches or exceeds the table bet, they can check
        if (this.currentBet <= player.currentBet) {
            this.wss.emit('action', { type: 'check', index: this.actionIndex });
            this.nextPlayer();
        }
    }

    fold(): void {
        this.players[this.actionIndex].folded = true;
        this.wss.emit('action', { type: 'fold', index: this.actionIndex });
        this.nextPlayer();
    }

    solveHandsAndGivePeoplePot(): {     username: string;     bal: number;     databaseId: string;     allIn: boolean;     folded: boolean;     currentBet: number;     cards: string[]; }[] {
        const winnersArray: {     username: string;     bal: number;     databaseId: string;     allIn: boolean;     folded: boolean;     currentBet: number;     cards: string[]; }[] = [];
        let remainingPot = this.pot;
        // Filter out players who folded.
        const activePlayers = this.players.filter(player => !player.folded);

        // Create a Map to track each active player's remaining contribution.
        const remainingStakes = new Map<User, number>();
        activePlayers.forEach(player => remainingStakes.set(player, player.currentPotStake));

        // Continue until no active player has any stake left.
        while (true) {
            // Get the list of players who still have a positive stake.
            const playersWithStake = activePlayers.filter(player => (remainingStakes.get(player) || 0) > 0);
            if (playersWithStake.length === 0) break;

            // Find the minimum remaining stake among these players.
            const minStake = Math.min(...playersWithStake.map(player => remainingStakes.get(player)!));

            // Calculate the side pot for this level.
            const sidePot = minStake * playersWithStake.length;

            // Determine eligible players for this pot (those who contributed in this round).
            // Here we recalc each player's hand score.
            let bestScore = -Infinity;
            let levelWinners: User[] = [];
            playersWithStake.forEach(player => {
                const score = evalHand(player.cards.concat(this.communityCards));
                if (score > bestScore) {
                    bestScore = score;
                    levelWinners = [player];
                } else if (score === bestScore) {
                    levelWinners.push(player);
                }
            });

            // Split the side pot evenly among winners.
            const share = Math.floor(sidePot / levelWinners.length);
            levelWinners.forEach(player => {
                player.bal += share;
                player.winnings += share;
                player.ws.emit('bal', { bal: player.bal });
                player.syncBal();
                winnersArray.push(player.getDataObjectWithCards());
            });

            remainingPot -= sidePot;

            // Subtract the minStake from each player's remaining stake.
            playersWithStake.forEach(player => {
                const updatedStake = (remainingStakes.get(player) || 0) - minStake;
                remainingStakes.set(player, updatedStake);
            });
        }

        return winnersArray;
    }
}
