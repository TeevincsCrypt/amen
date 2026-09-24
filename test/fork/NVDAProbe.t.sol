// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";

/// @notice TEMPORARY diagnostic probe of the live NVDA Stock Token on Robinhood Chain (4663).
///         Every method is called with a low-level staticcall so a revert never aborts the test.
///         Run: forge test --match-path test/fork/NVDAProbe.t.sol --fork-url https://rpc.mainnet.chain.robinhood.com -vv
contract NVDAProbeTest is Test {
    address nvda;

    function setUp() public {
        string memory cfg = vm.readFile(string.concat(vm.projectRoot(), "/config/4663.json"));
        nvda = vm.parseJsonAddress(cfg, ".nvda");
    }

    function test_ProbeNVDA() public view {
        console2.log("chainid", block.chainid);
        console2.log("block", block.number, "timestamp", block.timestamp);
        console2.log("NVDA", nvda);
        console2.log("NVDA code size", nvda.code.length);

        _probe("symbol()", 0);
        _probe("decimals()", 1);
        _probe("uiMultiplier()", 1);
        _probe("oraclePaused()", 2);
    }

    /// @param kind 0 = string, 1 = uint256, 2 = bool
    function _probe(string memory sig, uint8 kind) internal view {
        bytes4 sel = bytes4(keccak256(bytes(sig)));
        (bool ok, bytes memory ret) = nvda.staticcall(abi.encodeWithSelector(sel));
        console2.log("----", sig);
        console2.log("  selector", vm.toString(abi.encodePacked(sel)));
        console2.log("  success", ok);
        console2.log("  returndata length", ret.length);
        if (!ok) {
            console2.log("  revert bytes", vm.toString(ret));
            return;
        }
        if (ret.length < 32) {
            console2.log("  raw (too short to decode)", vm.toString(ret));
            return;
        }
        if (kind == 0) {
            console2.log("  value", abi.decode(ret, (string)));
        } else if (kind == 1) {
            console2.log("  value", abi.decode(ret, (uint256)));
        } else {
            uint256 w = abi.decode(ret, (uint256));
            console2.log("  value (bool)", w != 0);
            console2.log("  raw word", w);
        }
    }
}
