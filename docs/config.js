// Agent Ballot — site configuration.
// The parent fills in CONTRACT_ADDRESS and DEPLOY_BLOCK after deploying
// AgentBallot.sol on BNB Chain mainnet (chain id 56).
// Until then the site runs in preview mode: questions are shown, but the
// vote buttons stay disabled and a banner says the contract is not live yet.
const CONFIG = {
  CONTRACT_ADDRESS: "", // e.g. "0x..." — set after deploy
  DEPLOY_BLOCK: 0, // block the contract was deployed in — set after deploy
  CHAIN_ID: 56, // BNB Chain mainnet
  CHAIN_NAME: "BNB Chain",
  AGENT_ID_ADDRESS: "0x60b9262456de011f7d15a54cdd8c48baaa8b022f",
  RPC_URL: "https://bsc-dataseed.binance.org",
  EXPLORER: "https://bscscan.com",
};
