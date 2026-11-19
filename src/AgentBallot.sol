// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Agent Ballot — daily yes/no ballot for Agent ID holders
/// @notice Points only. No funds are ever held, no prizes are promised,
///         no gambling. A vote costs only the gas of the transaction.
/// @dev Day numbers are UTC days: day = block.timestamp / 1 days.
///      Question text lives off-chain (website + questions.json); only its
///      keccak256 hash is stored on-chain so anyone can verify the text.
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

contract AgentBallot {
    IAgentID public immutable agentId;
    address public immutable owner;

    struct Day {
        bytes32 questionHash;
        bool resolved;
        bool outcome;
        uint256 yesVotes;
        uint256 noVotes;
    }

    mapping(uint256 => Day) public dayInfo;
    /// @dev 0 = no vote, 1 = yes, 2 = no
    mapping(uint256 => mapping(address => uint8)) public votes;
    mapping(uint256 => address[]) public voters;
    /// @dev Per-user stats packed into ONE storage slot to keep resolve cheap:
    ///      bits 0..63 = points, bits 64..127 = streak, bits 128..191 = lastCorrectDay.
    mapping(address => uint256) public stats;

    event QuestionPosted(uint256 indexed day, bytes32 questionHash);
    event Voted(uint256 indexed day, address indexed voter, bool choice);
    event Resolved(uint256 indexed day, bool outcome, uint256 yesVotes, uint256 noVotes);

    error NotOwner();
    error NoAgentId();
    error NoQuestion();
    error AlreadyResolved();
    error AlreadyVoted();
    error QuestionExists();

    /// @dev owner_ is a constructor parameter (not msg.sender) so the
    ///      contract can be deployed through a factory (e.g. CreateX)
    ///      while the user's wallet still ends up as owner.
    constructor(address agentId_, address owner_) {
        agentId = IAgentID(agentId_);
        owner = owner_;
    }

    /// @notice Owner posts one question per day (hash of the question text).
    function postQuestion(uint256 day, bytes32 questionHash) external {
        if (msg.sender != owner) revert NotOwner();
        Day storage d = dayInfo[day];
        if (d.questionHash != bytes32(0)) revert QuestionExists();
        d.questionHash = questionHash;
        emit QuestionPosted(day, questionHash);
    }

    /// @notice Vote once per day. Caller must hold an Agent ID.
    function vote(uint256 day, bool choice) external {
        if (agentId.balanceOf(msg.sender) == 0) revert NoAgentId();
        Day storage d = dayInfo[day];
        if (d.questionHash == bytes32(0)) revert NoQuestion();
        if (d.resolved) revert AlreadyResolved();
        if (votes[day][msg.sender] != 0) revert AlreadyVoted();
        votes[day][msg.sender] = choice ? 1 : 2;
        voters[day].push(msg.sender);
        if (choice) {
            unchecked {
                ++d.yesVotes;
            }
        } else {
            unchecked {
                ++d.noVotes;
            }
        }
        emit Voted(day, msg.sender, choice);
    }

    /// @notice Owner resolves a day. Every voter who picked the outcome
    ///         earns 1 point; a correct vote on the day after a previous
    ///         correct day extends the voter's streak, otherwise it restarts at 1.
    /// @dev Gas grows with the number of voters that day (one storage write
    ///      per correct voter). Resolve promptly while voter counts are small.
    function resolve(uint256 day, bool outcome) external {
        if (msg.sender != owner) revert NotOwner();
        Day storage d = dayInfo[day];
        if (d.questionHash == bytes32(0)) revert NoQuestion();
        if (d.resolved) revert AlreadyResolved();
        d.resolved = true;
        d.outcome = outcome;
        address[] storage dayVoters = voters[day];
        uint256 n = dayVoters.length;
        for (uint256 i = 0; i < n;) {
            address v = dayVoters[i];
            if ((votes[day][v] == 1) == outcome) {
                uint256 s = stats[v];
                uint256 pts = uint64(s);
                uint256 streak = uint64(s >> 64);
                uint256 last = uint64(s >> 128);
                unchecked {
                    if (last + 1 == day) {
                        streak += 1;
                    } else {
                        streak = 1;
                    }
                    stats[v] =
                        uint256(uint64(pts + 1)) | (uint256(uint64(streak)) << 64) | (uint256(uint64(day)) << 128);
                }
            }
            unchecked {
                ++i;
            }
        }
        emit Resolved(day, outcome, d.yesVotes, d.noVotes);
    }

    function hasVoted(uint256 day, address voter) external view returns (bool) {
        return votes[day][voter] != 0;
    }

    function getTally(uint256 day)
        external
        view
        returns (uint256 yesVotes, uint256 noVotes, bool resolved, bool outcome)
    {
        Day storage d = dayInfo[day];
        return (d.yesVotes, d.noVotes, d.resolved, d.outcome);
    }

    function getPoints(address user) external view returns (uint256) {
        return uint64(stats[user]);
    }

    function getStreak(address user) external view returns (uint256) {
        return uint64(stats[user] >> 64);
    }

    function getStats(address user) external view returns (uint256 pts, uint256 streak) {
        uint256 s = stats[user];
        return (uint64(s), uint64(s >> 64));
    }

    function getVoters(uint256 day) external view returns (address[] memory) {
        return voters[day];
    }

    function currentDay() external view returns (uint256) {
        return block.timestamp / 1 days;
    }
}
