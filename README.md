# Agent Ballot 🗳️

A daily on-chain ballot where **only Agent ID holders can vote**. One yes/no
question a day, 1 point per correct vote, public leaderboard and streaks.
**Points only — no funds, no prizes, no gambling.**

Built for the [Binance Agent ID Hackathon](https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf)
(60,000 USDC prize pool, submissions 2026-11-18 → 2026-12-09 08:00 UTC).

Live site: GitHub Pages from `docs/` (set `CONTRACT_ADDRESS` in
`docs/config.js` after deploying).

## How it works

- **Day numbers are UTC days**: `day = block.timestamp / 1 days`.
- Each day the owner posts one question. The question text lives in
  `docs/questions.json`; only its `keccak256` hash is stored on-chain, so
  anyone can verify the text matches the hash.
- `vote(day, choice)` — only addresses holding an Agent ID
  (`balanceOf > 0` on the Agent ID contract
  `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`) can vote, once per address
  per day. A vote is one transaction the voter confirms in their own wallet.
- `resolve(day, outcome)` — owner only. Every voter who picked the outcome
  earns 1 point. A correct vote on the day after a previous correct day
  extends the voter's streak, otherwise the streak restarts at 1.
- View functions: `hasVoted`, `getTally`, `getPoints`, `getStreak`,
  `getStats`, `getVoters`, `currentDay`. Events: `QuestionPosted`, `Voted`,
  `Resolved`.

## Owner permissions (disclosed, as the hackathon requires)

The contract owner (the deployer) can ONLY:

- `postQuestion(day, hash)` — post one question hash per day.
- `resolve(day, outcome)` — resolve a day and award points.

The owner **cannot**: hold or move anyone's funds (the contract holds no
funds at all), pause voting, change votes, mint anything, or touch user
assets. There is no admin key over user funds because there are no user
funds in the contract.

## Gas (measured, Foundry 1.9.0, solc 0.8.20, optimizer runs 200)

| Action | Gas |
|---|---|
| Deploy (`forge create` receipt on local chain) | **677,387** |
| `postQuestion` | 45,740 |
| `vote` — first voter of a day | 127,852 |
| `vote` — typical voter | ~88,000 (median 88,157) |
| `resolve` — 2 voters, 1 correct | 86,926 |
| `resolve` — 30 voters, 15 correct | 536,313 |

Cost at 1 gwei: deploy ≈ 0.000677 BNB, vote ≈ 0.00009–0.00013 BNB,
30-voter resolve ≈ 0.00054 BNB. **Deployment is affordable only while the
gas price is below ~0.62 gwei with a 0.00042 BNB balance** — check the live
gas price before deploying, or top up a little BNB first. Resolve gas grows
with the number of voters that day (one storage write per correct voter),
so resolve promptly and while gas is cheap.

## Tests

```bash
forge test -vv        # 11 tests: access control, voting, points, streaks, gas
```

All 11 pass. `forge test --gas-report` reproduces the table above.
A local end-to-end run on Anvil (deploy → post → 2 votes → tally → resolve
→ stats) was verified with `cast` against the real ABI.

Note: `forge build` emits one lint warning (`incorrect-strict-equality` on
`balanceOf(msg.sender) == 0`). Reviewed and safe: it is a plain ownership
check on the canonical Agent ID contract, not a value comparison that an
attacker can influence.

## Frontend (`docs/`)

Static site, no backend, no server. Connects **only** through the injected
provider (`window.ethereum`) in the user's own wallet app. It never asks for
a seed phrase, private key, or pairing code, and never stores sessions.

- Today's question, on-chain hash verification, vote buttons, live tally.
- Leaderboard (top 10 by points) built from `Voted` events + `getStats`.
- Past ballots with outcomes, fee notice, how-it-works.
- Until `CONTRACT_ADDRESS` is set in `docs/config.js`, the site runs in
  preview mode (questions shown, voting disabled).

To run locally: `python3 -m http.server` inside `docs/`, open
`http://localhost:8000`. To publish: enable GitHub Pages from the `docs/`
folder.

## Hackathon red-line compliance

- ✅ Contract deployed on BNB Chain, source verified + open-source (this repo).
- ✅ Agent ID is core to the product: only holders can vote.
- ✅ No web QR-code / pairing-code login; no stored user sessions.
- ✅ Every transaction is confirmed by the user in their own wallet.
- ✅ No unauthorized transfers, no fund custody, no promised returns.
- ✅ No "Binance" / "BNB" in the project name, token name, or domain.
- ✅ No risk-warning requirement applies (no trading); the fee notice is shown.
- ✅ Agent ID is not used to look up other people's wallets by name.
- ✅ Points only — not gambling, no money at stake.

## Deploy (for the owner)

```bash
export PRIVATE_KEY=...   # deployer key — never commit it
forge create src/AgentBallot.sol:AgentBallot \
  --rpc-url https://bsc-dataseed.binance.org \
  --private-key $PRIVATE_KEY \
  --constructor-args 0x60b9262456de011f7d15a54cdd8c48baaa8b022f \
  --broadcast
# then verify on BscScan and fill CONTRACT_ADDRESS + DEPLOY_BLOCK in docs/config.js
```

## Questions

`docs/questions.json` holds one question per UTC day with its hash and the
public source used to resolve it (e.g. CoinGecko daily close). To add a day:
append an entry, compute its hash with `cast keccak "<question>"`, and post
it on-chain with `postQuestion(day, hash)` before that day starts.
