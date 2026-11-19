// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {AgentBallot} from "../src/AgentBallot.sol";

/// @notice Mock Agent ID: everyone holds one unless explicitly blocked.
contract MockAgentID {
    mapping(address => bool) public blocked;

    function balanceOf(address who) external view returns (uint256) {
        return blocked[who] ? 0 : 1;
    }

    function block(address who) external {
        blocked[who] = true;
    }
}

contract AgentBallotTest is Test {
    AgentBallot public ballot;
    MockAgentID public agentId;

    address public owner = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public carol = address(0xCA901);

    uint256 public constant DAY = 20776; // 2026-11-19 UTC day

    function setUp() public {
        agentId = new MockAgentID();
        ballot = new AgentBallot(address(agentId));
    }

    function testDeploymentGas() public {
        uint256 g = gasleft();
        AgentBallot b = new AgentBallot(address(agentId));
        uint256 used = g - gasleft();
        console.log("deployment gas:", used);
        assertEq(b.owner(), address(this));
        assertEq(address(b.agentId()), address(agentId));
    }

    function testOwnerCanPostQuestion() public {
        bytes32 h = keccak256("Will BTC close above $100k today?");
        ballot.postQuestion(DAY, h);
        (bytes32 stored,,,,) = ballot.dayInfo(DAY);
        assertEq(stored, h);
    }

    function testNonOwnerCannotPostOrResolve() public {
        vm.prank(alice);
        vm.expectRevert(AgentBallot.NotOwner.selector);
        ballot.postQuestion(DAY, bytes32(uint256(1)));

        ballot.postQuestion(DAY, bytes32(uint256(1)));
        vm.prank(alice);
        vm.expectRevert(AgentBallot.NotOwner.selector);
        ballot.resolve(DAY, true);
    }

    function testCannotPostSameQuestionTwice() public {
        ballot.postQuestion(DAY, bytes32(uint256(1)));
        vm.expectRevert(AgentBallot.QuestionExists.selector);
        ballot.postQuestion(DAY, bytes32(uint256(2)));
    }

    function testNonHolderCannotVote() public {
        agentId.block(carol);
        ballot.postQuestion(DAY, bytes32(uint256(1)));
        vm.prank(carol);
        vm.expectRevert(AgentBallot.NoAgentId.selector);
        ballot.vote(DAY, true);
    }

    function testCannotVoteWithoutQuestion() public {
        vm.prank(alice);
        vm.expectRevert(AgentBallot.NoQuestion.selector);
        ballot.vote(DAY, true);
    }

    function testVoteTallyAndDoubleVote() public {
        ballot.postQuestion(DAY, bytes32(uint256(1)));

        uint256 g = gasleft();
        vm.prank(alice);
        ballot.vote(DAY, true);
        uint256 voteGas = g - gasleft();
        console.log("vote gas (first voter):", voteGas);

        vm.prank(bob);
        ballot.vote(DAY, false);

        (uint256 yes, uint256 no, bool resolved,) = ballot.getTally(DAY);
        assertEq(yes, 1);
        assertEq(no, 1);
        assertEq(resolved, false);
        assertTrue(ballot.hasVoted(DAY, alice));
        assertFalse(ballot.hasVoted(DAY, carol));

        vm.prank(alice);
        vm.expectRevert(AgentBallot.AlreadyVoted.selector);
        ballot.vote(DAY, true);
    }

    function testResolveAwardsPointsAndStreak() public {
        ballot.postQuestion(DAY, bytes32(uint256(1)));
        vm.prank(alice);
        ballot.vote(DAY, true); // correct
        vm.prank(bob);
        ballot.vote(DAY, false); // wrong

        uint256 g = gasleft();
        ballot.resolve(DAY, true);
        uint256 resolveGas = g - gasleft();
        console.log("resolve gas (2 voters, 1 correct):", resolveGas);

        (uint256 ptsA, uint256 streakA) = ballot.getStats(alice);
        (uint256 ptsB, uint256 streakB) = ballot.getStats(bob);
        assertEq(ptsA, 1);
        assertEq(streakA, 1);
        assertEq(ptsB, 0);
        assertEq(streakB, 0);

        (,, bool resolved, bool outcome) = ballot.getTally(DAY);
        assertTrue(resolved);
        assertTrue(outcome);

        vm.prank(alice);
        vm.expectRevert(AgentBallot.AlreadyResolved.selector);
        ballot.vote(DAY, true);

        vm.expectRevert(AgentBallot.AlreadyResolved.selector);
        ballot.resolve(DAY, false);
    }

    function testStreakAcrossConsecutiveDays() public {
        // Day 1 correct, day 2 correct -> streak 2. Day 4 correct after a gap -> streak 1.
        ballot.postQuestion(DAY, bytes32(uint256(1)));
        ballot.postQuestion(DAY + 1, bytes32(uint256(2)));
        ballot.postQuestion(DAY + 3, bytes32(uint256(3)));

        vm.prank(alice);
        ballot.vote(DAY, true);
        vm.prank(alice);
        ballot.vote(DAY + 1, true);
        vm.prank(alice);
        ballot.vote(DAY + 3, true);

        ballot.resolve(DAY, true);
        ballot.resolve(DAY + 1, true);
        (, uint256 streak) = ballot.getStats(alice);
        assertEq(streak, 2);

        ballot.resolve(DAY + 3, true);
        (uint256 pts, uint256 streakAfterGap) = ballot.getStats(alice);
        assertEq(pts, 3);
        assertEq(streakAfterGap, 1);
    }

    function testResolveGas30Voters() public {
        ballot.postQuestion(DAY, bytes32(uint256(1)));
        // 30 voters: even addresses vote yes, odd vote no. Resolve yes.
        for (uint256 i = 0; i < 30; i++) {
            address v = address(uint160(0x1000 + i));
            vm.prank(v);
            ballot.vote(DAY, i % 2 == 0);
        }
        (uint256 yes, uint256 no,,) = ballot.getTally(DAY);
        assertEq(yes, 15);
        assertEq(no, 15);

        uint256 g = gasleft();
        ballot.resolve(DAY, true);
        uint256 resolveGas = g - gasleft();
        console.log("resolve gas (30 voters, 15 correct):", resolveGas);

        (uint256 pts,) = ballot.getStats(address(uint160(0x1000)));
        assertEq(pts, 1);
        (uint256 ptsOdd,) = ballot.getStats(address(uint160(0x1001)));
        assertEq(ptsOdd, 0);
    }

    function testGetVotersAndCurrentDay() public {
        ballot.postQuestion(DAY, bytes32(uint256(1)));
        vm.prank(alice);
        ballot.vote(DAY, true);
        address[] memory vs = ballot.getVoters(DAY);
        assertEq(vs.length, 1);
        assertEq(vs[0], alice);
        assertEq(ballot.currentDay(), block.timestamp / 1 days);
    }
}
