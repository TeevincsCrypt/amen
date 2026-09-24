// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AmenOracle} from "../src/AmenOracle.sol";
import {VespersVault} from "../src/VespersVault.sol";
import {AmenMarket} from "../src/AmenMarket.sol";
import {UniswapV3PoolAdapter} from "../src/adapters/UniswapV3PoolAdapter.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IStockToken} from "../src/interfaces/IStockToken.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockAggregator} from "../src/mocks/MockAggregator.sol";
import {MockSwapAdapter} from "../src/mocks/MockSwapAdapter.sol";

abstract contract DeployBase is Script {
    struct Core {
        AmenOracle oracle;
        VespersVault vault;
        AmenMarket market;
    }

    function _deployCore(address owner, address usdg, address nvda, address feed, address feeRecipient)
        internal
        returns (Core memory c)
    {
        // Deployer is the initial owner so it can wire things; ownership moves to `owner` at the end (2-step).
        address deployer = msg.sender;
        c.oracle = new AmenOracle(deployer);
        c.oracle.setFeed(nvda, feed);
        c.vault = new VespersVault(deployer, usdg, nvda, address(c.oracle), feeRecipient);
        c.market = new AmenMarket(deployer, usdg, address(c.oracle), feeRecipient);
        c.market.setStockAllowed(nvda, true);
        if (owner != deployer) {
            c.oracle.transferOwnership(owner);
            c.vault.transferOwnership(owner);
            c.market.transferOwnership(owner);
        }
    }

    function _write(Core memory c, address usdg, address nvda, address feed, address adapter) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployedAtBlock", block.number);
        vm.serializeAddress(k, "usdg", usdg);
        vm.serializeAddress(k, "nvda", nvda);
        vm.serializeAddress(k, "nvdaFeed", feed);
        vm.serializeAddress(k, "swapAdapter", adapter);
        vm.serializeAddress(k, "oracle", address(c.oracle));
        vm.serializeAddress(k, "vault", address(c.vault));
        string memory out = vm.serializeAddress(k, "market", address(c.market));
        string memory path =
            string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
        console2.log("wrote", path);
    }
}

/// @notice Mainnet (4663) deploy from config/4663.json. Refuses any other chain and re-checks
///         symbol/decimals/bytecode before broadcasting.
/// forge script script/Deploy.s.sol:DeployMainnet --rpc-url robinhood --broadcast \
///   --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
contract DeployMainnet is DeployBase {
    function run() external {
        require(block.chainid == 4663, "DeployMainnet: chainid != 4663");
        string memory cfg = vm.readFile(string.concat(vm.projectRoot(), "/config/4663.json"));
        address usdg = vm.parseJsonAddress(cfg, ".usdg");
        address nvda = vm.parseJsonAddress(cfg, ".nvda");
        address feed = vm.parseJsonAddress(cfg, ".nvdaFeed");
        address factory = vm.parseJsonAddress(cfg, ".uniswapV3Factory");
        uint24 feeTier = uint24(vm.parseJsonUint(cfg, ".uniswapFeeTier"));

        // Live re-verification (brief: "Always re-read symbol(), decimals(), and bytecode on-chain").
        require(usdg.code.length > 0 && nvda.code.length > 0 && feed.code.length > 0, "missing bytecode");
        require(IERC20Metadata(usdg).decimals() == 6, "USDG decimals != 6");
        require(IStockToken(nvda).decimals() == 18, "NVDA decimals != 18");
        require(IStockToken(nvda).uiMultiplier() > 0, "NVDA uiMultiplier");
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(feed).latestRoundData();
        require(answer > 0 && updatedAt > 0, "feed");
        console2.log("USDG", IERC20Metadata(usdg).symbol());
        console2.log("NVDA", IStockToken(nvda).symbol(), "feed decimals", IAggregatorV3(feed).decimals());

        address owner = vm.envOr("OWNER", msg.sender);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", owner);

        vm.startBroadcast();
        UniswapV3PoolAdapter adapter = new UniswapV3PoolAdapter(factory, feeTier);
        Core memory c = _deployCore(owner, usdg, nvda, feed, feeRecipient);
        // Ownable2Step: the deployer stays owner until `owner` accepts, so wiring still works here.
        c.vault.setSwapAdapter(address(adapter));
        vm.stopBroadcast();

        _write(c, usdg, nvda, feed, address(adapter));
    }
}

/// @notice Testnet (46630) / local anvil (`anvil --chain-id 46630`) deploy with mocks that implement
///         uiMultiplier, balanceOfUI and oraclePaused. Seeds a Friday-close feed round and demo balances.
/// forge script script/Deploy.s.sol:DeployTestnet --rpc-url local --broadcast
contract DeployTestnet is DeployBase {
    function run() external {
        require(block.chainid == 46630, "DeployTestnet: chainid != 46630");
        address deployer = msg.sender;

        vm.startBroadcast();
        MockUSDG usdg = new MockUSDG();
        MockStockToken nvda = new MockStockToken("NVIDIA Stock Token (mock)", "NVDA");
        MockAggregator feed = new MockAggregator(8, "NVDA / USD (mock)");
        MockSwapAdapter adapter = new MockSwapAdapter(address(usdg), address(nvda), 180e18);

        // Seed a price so the oracle has a mark. The round is stamped at block time.
        feed.setAnswer(180_00000000);

        Core memory c = _deployCore(deployer, address(usdg), address(nvda), address(feed), deployer);
        c.vault.setSwapAdapter(address(adapter));
        c.vault.setKeeper(deployer, true);
        c.market.setKeeper(deployer, true);
        c.oracle.setKeeper(deployer, true);

        // Demo balances for anvil accounts 0..2 (the default mnemonic).
        address[3] memory demo = [
            deployer, 0x70997970C51812dc3A010C7d01b50e0d17dc79C8, 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
        ];
        for (uint256 i; i < demo.length; ++i) {
            usdg.mint(demo[i], 10_000e6);
            nvda.mint(demo[i], 2e18);
        }
        vm.stopBroadcast();

        _write(c, address(usdg), address(nvda), address(feed), address(adapter));
    }
}
