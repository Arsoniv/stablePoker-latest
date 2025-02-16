
export default class Round {
    pot = 0;
    players;
    currentBet = 0;
    newMoneyIn = 0;
    actionIndex = 0;
    mostRecentHappyIndex = 0;
    communityCards = [];
    cardsDealt = [];
    bigBind;
    smallBlind;
    roundEnded = false
    wss;
    endOfRoundCallback;

    randomCard() {
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

    stage = 0;

    /*
    0 - none
    1 - preFlop
    2 - postFlop
    3 - post turn
    4 - postRiver
    5 - postRound
     */

    constructor(players, bigBlind, smallBlind, webSocketServer, callback) {
        this.players = players;
        this.bigBind = bigBlind;
        this.smallBlind = smallBlind;
        this.wss = webSocketServer;
        this.endOfRoundCallback = callback;

        this.payBlinds();
    }

    payBlinds() {
        this.players[1].bal -= this.smallBlind;
        this.players[1].syncBal();

        if (this.players[2]) {
            this.players[2].bal -= this.smallBlind;
            this.players[2].syncBal();
        }else {
            this.players[0].bal -= this.smallBlind;
            this.players[0].syncBal();
        }
    }

    nextPlayer() {
        const prevActionIndex = this.actionIndex;
        let suitablePlayers = 0;
        this.players.forEach((player) => {
            if (!player.allIn && !player.folded) {
                suitablePlayers++;
            }
        })
        if (suitablePlayers >= 2) {
            let foundPlayer = false;
            let iterations = 0;
            while (!foundPlayer && iterations <= 1000) {
                this.actionIndex++;
                if (this.actionIndex > 10) {
                    this.actionIndex = 0;
                }
                if (this.players[this.actionIndex]) {
                    if (!this.players[this.actionIndex].allIn && !this.players[this.actionIndex].folded && this.actionIndex !== prevActionIndex) {
                        foundPlayer = true;
                    }
                }
                iterations++;
            }

            if (iterations > 1000) {
                console.log('could not find suitable player')
                this.endRound();
            }else {
                if (this.actionIndex === this.mostRecentHappyIndex) {
                    this.endStage();
                }
            }
        }else {
            this.endRound();
        }
    }

    endRound() {
        this.roundEnded = true;
        this.solveHandsAndGivePeoplePot()
        this.endOfRoundCallback();
    }

    endStage() {
        this.currentBet = 0;
        this.mostRecentHappyIndex = 0;
        this.actionIndex = 0;
        this.pot+=this.newMoneyIn;
        this.stage++;


        //functions run at the start of their respective stage

        if (this.stage === 2) { // post flop
            this.communityCards.push(this.randomCard());
            this.communityCards.push(this.randomCard());
            this.communityCards.push(this.randomCard());

        }else if (this.stage === 3) { // post turn
            this.communityCards.push(this.randomCard());


        }else if (this.stage === 4) {// post river
            this.communityCards.push(this.randomCard());

        }else if (this.stage === 5) { // post round
            this.endRound();
        }
    }

    raise(amount) {
        const player = this.players[this.actionIndex];
        // Calculate the amount needed to match the current bet first
        const callAmount = this.currentBet - player.currentBet;
        // Total amount the player must put in to raise
        const totalRequired = callAmount + amount;

        if (player.bal >= totalRequired) {
            this.mostRecentHappyIndex = this.actionIndex;
            // Increase the table's current bet by the raise amount
            this.currentBet += amount;

            // Update how much the player is putting in this round
            const putIn = this.currentBet - player.currentBet;
            this.newMoneyIn += putIn;
            player.currentPotStake += putIn;

            // Deduct from the player's balance and update their current bet
            player.bal -= putIn;
            player.currentBet = this.currentBet;

            if (player.bal === 0) {
                player.allIn = true;
            }

            this.wss.emit('action', {type: 'raise', index: this.actionIndex})

            player.syncBal();
            this.nextPlayer();
        } else {
            // If the player cannot afford a raise, fall back to calling
            this.call();
        }
    }

    call() {
        const player = this.players[this.actionIndex];
        // Calculate the amount needed to match the current bet
        const callAmount = this.currentBet - player.currentBet;

        // If there's nothing to call, just check
        if (callAmount <= 0) {
            this.check();
        } else {
            if (player.bal >= callAmount) {
                this.newMoneyIn += callAmount;
                player.bal -= callAmount;
                // Update the player's bet to match the table's current bet
                player.currentBet = this.currentBet;
                this.wss.emit('action', {type: 'call', index: this.actionIndex, allIn: false})
                player.syncBal();
                this.nextPlayer();
            } else {
                // The player doesn't have enough chips to fully call
                // They put in whatever chips they have, marking them all-in.
                this.newMoneyIn += player.bal;
                // Update the player's current bet with the remaining balance they can commit
                player.currentBet += player.bal;
                player.currentPotStake += player.currentBet;
                // Set balance to zero and mark as all-in
                player.bal = 0;
                player.allIn = true;
                this.wss.emit('action', {type: 'call', index: this.actionIndex, allIn: true})
                player.syncBal();
                this.nextPlayer();
            }
        }
    }

    check() {
        const player = this.players[this.actionIndex];
        // If the player's current bet already matches or exceeds the table bet, they can check
        if (this.currentBet <= player.currentBet) {
            this.wss.emit('action', {type: 'check', index: this.actionIndex})
            this.nextPlayer();
        }
    }

    fold() {
        this.players[this.actionIndex].folded = true;
        this.wss.emit('action', {type: 'fold', index: this.actionIndex})
        this.nextPlayer();
    }

    solveHandsAndGivePeoplePot/*lol*/() {
        let scores = [];

        // Evaluate hand scores for all non-folded players
        this.players.forEach((player, index) => {
            if (!player.folded) {
                const allCards = player.cards.concat(this.communityCards);
                const handScore = eval(allCards);
                scores.push([handScore, index]);
            }
        });

        // Sort scores in descending order (best hand first)
        scores.sort((a, b) => b[0] - a[0]);

        console.log(scores);

        let i = 0;
        while (i < scores.length && this.pot > 0) {
            let sameScorePlayers = [scores[i]];

            // Collect all players with the same score (for ties)
            while (i + 1 < scores.length && scores[i][0] === scores[i + 1][0]) {
                sameScorePlayers.push(scores[i + 1]);
                i++;
            }

            // Find the **minimum stake** among tied players (this determines the max they can win)
            const minStake = Math.min(...sameScorePlayers.map(score => this.players[score[1]].currentPotStake));
            const maxPayAmount = minStake * sameScorePlayers.length;
            let amountToDistribute = Math.min(this.pot, maxPayAmount);

            // Split among tied players
            let share = Math.floor(amountToDistribute / sameScorePlayers.length);
            let remainder = amountToDistribute % sameScorePlayers.length;

            sameScorePlayers.forEach((score, index) => {
                this.players[score[1]].bal += share;
                // Give remainder to the first few players to balance it out
                if (remainder > 0) {
                    this.players[score[1]].bal += 1;
                    remainder--;
                }
            });

            // Deduct the distributed amount from the pot
            this.pot -= amountToDistribute;
            i++;
        }
    }


}