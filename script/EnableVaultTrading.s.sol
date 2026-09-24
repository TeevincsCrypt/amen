// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {UniswapV3PoolAdapter, IUniswapV3Factory} from "../src/adapters/UniswapV3PoolAdapter.sol";
import {VespersVault} from "../src/VespersVault.sol";

/// @notice Step 1 of turning on vault trading on Robinhood Chain (4663): deploy the Uniswap V3
///         swap adapter for the vault's NVDA/USDG pool. It sets nothing on the vault. The Safe then
///         makes the two calls this script prints. Run the fork test first (docs/LAUNCH.md §9).
///
///         forge script script/EnableVaultTrading.s.sol --rpc-url robinhood -vv              (dry run)
///         forge script script/EnableVaultTrading.s.sol --rpc-url robinhood --broadcast --ledger \
///           --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
contract EnableVaultTrading is Script {
    /// Beta inventory cap written into the vault by the Safe: 20% of NAV (the contract allows 50%).
    uint256 internal constant BETA_MAX_INVENTORY_BPS = 2_000;

    function run() external {
        require(block.chainid == 4663, "Robinhood Chain mainnet (4663) only");
        string memory root = vm.projectRoot();
        string memory cfg = vm.readFile(string.concat(root, "/config/4663.json"));
        address usdg = vm.parseJsonAddress(cfg, ".usdg");
        address nvda = vm.parseJsonAddress(cfg, ".nvda");
        address factory = vm.parseJsonAddress(cfg, ".uniswapV3Factory");
        address pool = vm.parseJsonAddress(cfg, ".nvdaUsdgPool");
        uint24 fee = uint24(vm.parseJsonUint(cfg, ".uniswapFeeTier"));

        string memory depPath = string.concat(root, "/deployments/4663.json");
        VespersVault vault = VespersVault(vm.parseJsonAddress(vm.readFile(depPath), ".vault"));

        require(address(vault.stock()) == nvda, "vault stock is not NVDA from config/4663.json");
        require(address(vault.asset()) == usdg, "vault asset is not USDG from config/4663.json");
        require(
            IUniswapV3Factory(factory).getPool(usdg, nvda, fee) == pool, "factory.getPool != configured pool"
        );
        require(address(vault.swapAdapter()) == address(0), "vault already has a swap adapter");

        vm.startBroadcast();
        UniswapV3PoolAdapter adapter = new UniswapV3PoolAdapter(factory, fee);
        vm.stopBroadcast();

        require(address(adapter.factory()) == factory && adapter.feeTier() == fee, "adapter config");
        bool live = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)
            || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        if (live) {
            vm.writeJson(vm.toString(address(adapter)), depPath, ".swapAdapter");
        } else {
            console2.log("DRY RUN: nothing sent; the address below is simulated. Add --broadcast to deploy.");
        }

        console2.log("swap adapter deployed:", address(adapter));
        console2.log("pool (NVDA/USDG, 0.05%):", pool);
        console2.log("vault:", address(vault));
        console2.log("NEXT: from the Safe, on the vault, in this order:");
        console2.log(
            string.concat(
                "  1. setParams(",
                vm.toString(BETA_MAX_INVENTORY_BPS),
                ", ",
                vm.toString(vault.perfFeeBps()),
                ", ",
                vm.toString(vault.maxDeviationBps()),
                ", false)   <- inventory at most 20% of NAV for the beta"
            )
        );
        console2.log(string.concat("  2. setSwapAdapter(", vm.toString(address(adapter)), ")"));
        console2.log("Then set VAULT_TRADING=on on the keeper.");
        console2.log(
            "To turn trading off: set VAULT_TRADING=off; once the vault is flat, setSwapAdapter(0x0)"
        );
    }
}
