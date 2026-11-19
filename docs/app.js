// Agent Ballot — front end. Static site, no backend, no server.
// Connects ONLY through the injected provider (window.ethereum) in the
// user's own wallet app. Never QR codes, never pairing codes, never
// stored sessions. Every transaction is confirmed by the user in their wallet.

const BALLOT_ABI = [
  "function agentId() view returns (address)",
  "function owner() view returns (address)",
  "function dayInfo(uint256) view returns (bytes32 questionHash, bool resolved, bool outcome, uint256 yesVotes, uint256 noVotes)",
  "function votes(uint256,address) view returns (uint8)",
  "function hasVoted(uint256,address) view returns (bool)",
  "function getTally(uint256) view returns (uint256 yesVotes, uint256 noVotes, bool resolved, bool outcome)",
  "function getStats(address) view returns (uint256 pts, uint256 streak)",
  "function getPoints(address) view returns (uint256)",
  "function getStreak(address) view returns (uint256)",
  "function vote(uint256,bool)",
  "function currentDay() view returns (uint256)",
  "event QuestionPosted(uint256 indexed day, bytes32 questionHash)",
  "event Voted(uint256 indexed day, address indexed voter, bool choice)",
  "event Resolved(uint256 indexed day, bool outcome, uint256 yesVotes, uint256 noVotes)",
];
const AGENT_ID_ABI = ["function balanceOf(address) view returns (uint256)"];

const $ = (id) => document.getElementById(id);
const shortAddr = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "—");
const todayDay = () => Math.floor(Date.now() / 86400000);
const fmtDate = (d) =>
  new Date(d * 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

let questions = [];
let readProvider = null;
let ballot = null; // read-only contract
let agentId = null;
let signer = null;
let signerContract = null;
let userAddr = null;
let currentDayNum = todayDay();
let todayQuestion = null;
let dayState = null; // { questionHash, resolved, outcome, yesVotes, noVotes }

function showBanner(text, kind) {
  const b = $("banner");
  b.textContent = text;
  b.className = "banner " + (kind || "info");
  b.classList.remove("hidden");
}

async function loadQuestions() {
  const res = await fetch("questions.json");
  const data = await res.json();
  questions = data.questions || [];
}

function renderToday() {
  $("today-date").textContent = fmtDate(currentDayNum);
  todayQuestion = questions.find((q) => q.day === currentDayNum) || null;
  if (!todayQuestion) {
    $("question").textContent = "No question posted for today yet — check back soon.";
    $("question-meta").textContent = "";
    $("verify-note").textContent = "";
    return;
  }
  $("question").textContent = todayQuestion.question;
  $("question-meta").textContent = "Outcome source: " + todayQuestion.source;
}

function renderTally() {
  if (!dayState) {
    $("tally-yes").textContent = "0";
    $("tally-no").textContent = "0";
    $("tally-yes-pct").textContent = "—";
    $("tally-no-pct").textContent = "—";
    $("tally-yes-fill").style.width = "50%";
    $("tally-state").textContent = "";
    return;
  }
  const yes = Number(dayState.yesVotes);
  const no = Number(dayState.noVotes);
  const total = yes + no;
  $("tally-yes").textContent = yes;
  $("tally-no").textContent = no;
  $("tally-yes-pct").textContent = total ? Math.round((yes / total) * 100) + "%" : "—";
  $("tally-no-pct").textContent = total ? Math.round((no / total) * 100) + "%" : "—";
  $("tally-yes-fill").style.width = total ? (yes / total) * 100 + "%" : "50%";
  $("tally-state").textContent = dayState.resolved
    ? "Resolved: the outcome was " + (dayState.outcome ? "YES" : "NO") + "."
    : total === 0
      ? "No votes yet — be the first."
      : total + " vote" + (total === 1 ? "" : "s") + " so far.";
}

async function refreshDay() {
  if (!ballot || !todayQuestion) {
    renderTally();
    return;
  }
  try {
    const info = await ballot.dayInfo(currentDayNum);
    dayState = {
      questionHash: info[0],
      resolved: info[1],
      outcome: info[2],
      yesVotes: info[3],
      noVotes: info[4],
    };
    const computed = ethers.keccak256(ethers.toUtf8Bytes(todayQuestion.question));
    const onChain = dayState.questionHash;
    if (onChain === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      $("verify-note").textContent = "⚠️ The question for today has not been posted on-chain yet.";
    } else if (computed.toLowerCase() === onChain.toLowerCase()) {
      $("verify-note").textContent = "✓ Question text verified against the on-chain hash.";
    } else {
      $("verify-note").textContent = "⚠️ Warning: this question text does NOT match the on-chain hash. Do not vote.";
    }
  } catch (e) {
    console.error(e);
    $("verify-note").textContent = "Could not read the contract just now — please refresh.";
    dayState = null;
  }
  renderTally();
  await refreshVoteButtons();
}

async function refreshVoteButtons() {
  const yesBtn = $("vote-yes");
  const noBtn = $("vote-no");
  const status = $("vote-status");
  yesBtn.disabled = true;
  noBtn.disabled = true;
  if (!ballot || !todayQuestion) {
    status.textContent = "Voting opens once the contract is live.";
    return;
  }
  if (!dayState || dayState.questionHash === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    status.textContent = "No question on-chain for today yet.";
    return;
  }
  if (dayState.resolved) {
    status.textContent = "This ballot is resolved — see past ballots below.";
    return;
  }
  if (!userAddr) {
    status.textContent = "Connect your wallet to vote.";
    return;
  }
  try {
    const holds = (await agentId.balanceOf(userAddr)) > 0n;
    if (!holds) {
      status.textContent = "This wallet does not hold an Agent ID, so it cannot vote.";
      return;
    }
    const voted = await ballot.hasVoted(currentDayNum, userAddr);
    if (voted) {
      const choice = await ballot.votes(currentDayNum, userAddr);
      status.textContent = "You already voted " + (choice === 1n ? "YES" : "NO") + " today. One vote per day.";
      return;
    }
    yesBtn.disabled = false;
    noBtn.disabled = false;
    status.textContent = "You can vote once today. Your vote is a transaction you confirm in your wallet.";
  } catch (e) {
    console.error(e);
    status.textContent = "Could not check your vote status — please refresh.";
  }
}

async function refreshUserStats() {
  if (!ballot || !userAddr) return;
  try {
    const [pts, streak] = await ballot.getStats(userAddr);
    $("points").textContent = pts.toString();
    $("streak").textContent = streak.toString() + (streak > 0n ? " 🔥" : "");
  } catch (e) {
    console.error(e);
  }
}

async function loadLeaderboard() {
  const el = $("leaderboard");
  if (!ballot || !CONFIG.DEPLOY_BLOCK) {
    el.innerHTML = "<p class='muted'>Leaderboard appears once the contract is live and votes are in.</p>";
    return;
  }
  try {
    const events = await ballot.queryFilter(ballot.filters.Voted, CONFIG.DEPLOY_BLOCK);
    const voters = [...new Set(events.map((e) => e.args.voter))];
    if (voters.length === 0) {
      el.innerHTML = "<p class='muted'>No votes yet — be the first.</p>";
      return;
    }
    const rows = [];
    for (const v of voters) {
      const [pts, streak] = await ballot.getStats(v);
      rows.push({ addr: v, pts: Number(pts), streak: Number(streak) });
    }
    rows.sort((a, b) => b.pts - a.pts || b.streak - a.streak);
    const top = rows.slice(0, 10);
    el.innerHTML =
      "<table class='board'><thead><tr><th>#</th><th>Voter</th><th class='num'>Points</th><th class='num'>Streak</th></tr></thead><tbody>" +
      top
        .map(
          (r, i) =>
            "<tr" +
            (userAddr && r.addr.toLowerCase() === userAddr.toLowerCase() ? " class='me'" : "") +
            "><td>" +
            (i + 1) +
            "</td><td class='mono'>" +
            shortAddr(r.addr) +
            "</td><td class='num'>" +
            r.pts +
            "</td><td class='num'>" +
            r.streak +
            "</td></tr>"
        )
        .join("") +
      "</tbody></table>";
  } catch (e) {
    console.error(e);
    el.innerHTML = "<p class='muted'>Could not load the leaderboard right now.</p>";
  }
}

async function loadHistory() {
  const el = $("history");
  const past = questions.filter((q) => q.day < currentDayNum).sort((a, b) => b.day - a.day);
  if (past.length === 0) {
    el.innerHTML = "<p class='muted'>No past ballots yet.</p>";
    return;
  }
  let html = "";
  for (const q of past) {
    let state = "Pending";
    let badge = "pending";
    let tally = "";
    if (ballot) {
      try {
        const t = await ballot.getTally(q.day);
        if (t[2]) {
          state = "Resolved: " + (t[3] ? "YES" : "NO");
          badge = "done";
        } else if (t[0] + t[1] > 0n) {
          state = "Open";
          badge = "open";
        }
        tally = " · 👍 " + t[0] + " / 👎 " + t[1];
      } catch (e) {
        console.error(e);
      }
    }
    html +=
      "<div class='history-item'><div class='q'>" +
      q.question +
      "<span class='badge " +
      badge +
      "'>" +
      state +
      "</span></div><div class='muted small'>" +
      q.date +
      tally +
      " · " +
      q.source +
      "</div></div>";
  }
  el.innerHTML = html;
}

async function connectWallet() {
  if (!window.ethereum) {
    showBanner(
      "No wallet found in this browser. Open this page inside your wallet app (for example the Binance Wallet app browser) and try again.",
      "warn"
    );
    return;
  }
  try {
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    const network = await browserProvider.getNetwork();
    if (Number(network.chainId) !== CONFIG.CHAIN_ID) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x" + CONFIG.CHAIN_ID.toString(16) }],
        });
      } catch (switchErr) {
        if (switchErr.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x" + CONFIG.CHAIN_ID.toString(16),
                chainName: CONFIG.CHAIN_NAME,
                nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
                rpcUrls: [CONFIG.RPC_URL],
                blockExplorerUrls: [CONFIG.EXPLORER],
              },
            ],
          });
        } else {
          throw switchErr;
        }
      }
    }
    const accounts = await browserProvider.send("eth_requestAccounts", []);
    userAddr = accounts[0];
    signer = await browserProvider.getSigner();
    signerContract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, BALLOT_ABI, signer);
    $("connect-btn").textContent = "Connected";
    $("connect-btn").disabled = true;
    $("wallet-status").textContent = "Connected. Votes are transactions you confirm in your wallet.";
    $("wallet-details").classList.remove("hidden");
    $("addr").textContent = shortAddr(userAddr);
    $("network-note").textContent = "Network: " + CONFIG.CHAIN_NAME + " (chain " + CONFIG.CHAIN_ID + ").";
    const holds = (await agentId.balanceOf(userAddr)) > 0n;
    $("agent-id").textContent = holds ? "✓ Holder" : "✗ No Agent ID";
    await refreshUserStats();
    await refreshVoteButtons();
    await loadLeaderboard();
  } catch (e) {
    console.error(e);
    showBanner("Could not connect: " + (e && e.message ? e.message : e), "warn");
  }
}

async function vote(choice) {
  if (!signerContract) return;
  $("vote-status").textContent = "Confirm the transaction in your wallet…";
  $("vote-yes").disabled = true;
  $("vote-no").disabled = true;
  try {
    const tx = await signerContract.vote(currentDayNum, choice);
    $("vote-status").textContent = "Transaction sent — waiting for confirmation…";
    await tx.wait();
    $("vote-status").textContent = "Vote counted ✓. Thank you!";
    await refreshDay();
    await refreshUserStats();
    await loadLeaderboard();
  } catch (e) {
    console.error(e);
    const msg = e && e.message ? e.message : String(e);
    if (/user rejected|User denied/i.test(msg)) {
      $("vote-status").textContent = "Transaction cancelled in your wallet — no vote recorded, no gas spent.";
    } else {
      $("vote-status").textContent = "Vote failed: " + msg.slice(0, 200);
    }
    await refreshVoteButtons();
  }
}

async function init() {
  renderToday();
  if (typeof ethers === "undefined") {
    showBanner("Could not load the wallet library (ethers). Check your connection and refresh.", "warn");
    await loadHistory();
    return;
  }
  readProvider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  if (!CONFIG.CONTRACT_ADDRESS) {
    showBanner(
      "Preview mode: the ballot contract has not been deployed yet. Questions are shown below, but voting opens once the contract is live.",
      "info"
    );
    $("contract-link").textContent = "not deployed yet";
    await loadHistory();
    return;
  }
  ballot = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, BALLOT_ABI, readProvider);
  agentId = new ethers.Contract(CONFIG.AGENT_ID_ADDRESS, AGENT_ID_ABI, readProvider);
  const link = document.createElement("a");
  link.href = CONFIG.EXPLORER + "/address/" + CONFIG.CONTRACT_ADDRESS;
  link.target = "_blank";
  link.rel = "noopener";
  link.className = "mono";
  link.textContent = shortAddr(CONFIG.CONTRACT_ADDRESS);
  $("contract-link").replaceWith(link);
  await refreshDay();
  await loadHistory();
  await loadLeaderboard();
  if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged", () => window.location.reload());
  }
}

$("connect-btn").addEventListener("click", connectWallet);
$("vote-yes").addEventListener("click", () => vote(true));
$("vote-no").addEventListener("click", () => vote(false));

init();
