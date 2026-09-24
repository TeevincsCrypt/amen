// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AmenOracle} from "../src/AmenOracle.sol";
import {VespersVault} from "../src/VespersVault.sol";
import {AmenMarket} from "../src/AmenMarket.sol";
import {UniswapV3PoolAdapter, IUniswapV3Factory} from "../src/adapters/UniswapV3PoolAdapter.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IStockToken} from "../src/interfaces/IStockToken.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockAggregator} from "../src/mocks/MockAggregator.sol";
import {MockSwapAdapter} from "../src/mocks/MockSwapAdapter.sol";
import {SessionLib} from "../src/libraries/SessionLib.sol";

abstract contract DeployBase is Script {
    struct Core {
        AmenOracle oracle;
        VespersVault vault;
        AmenMarket market;
    }

    /// @dev Deploys and wires the core. The deployer stays owner so the caller can finish
    ///      configuration; call `_handOver` last (Ownable2Step: `owner` must then accept).
    function _deployCore(
        address usdg,
        address nvda,
        address feed,
        address feeRecipient,
        uint256[] memory holidays
    ) internal returns (Core memory c) {
        address deployer = msg.sender;
        c.oracle = new AmenOracle(deployer);
        c.oracle.setFeed(nvda, feed);
        c.vault = new VespersVault(deployer, usdg, nvda, address(c.oracle), feeRecipient);
        c.market = new AmenMarket(deployer, usdg, address(c.oracle), feeRecipient);
        c.market.setStockAllowed(nvda, true);
        for (uint256 i; i < holidays.length; ++i) {
            c.oracle.setHoliday(holidays[i], true);
        }
    }

    function _handOver(Core memory c, address owner) internal {
        if (owner == msg.sender) return;
        c.oracle.transferOwnership(owner);
        c.vault.transferOwnership(owner);
        c.market.transferOwnership(owner);
    }

    /// @dev Next two NYSE full-day holidays after this build (2026-09-24): Thanksgiving and Christmas.
    function _defaultHolidays() internal pure returns (uint256[] memory h) {
        h = new uint256[](2);
        h[0] = SessionLib.daysFromCivil(2026, 11, 26);
        h[1] = SessionLib.daysFromCivil(2026, 12, 25);
    }

    /// @dev "YYYY-MM-DD" strings to UTC day indices (the oracle's holiday keys).
    function _parseDays(string[] memory dates) internal pure returns (uint256[] memory out) {
        out = new uint256[](dates.length);
        for (uint256 i; i < dates.length; ++i) {
            string[] memory p = vm.split(dates[i], "-");
            require(p.length == 3, "bad date");
            out[i] = SessionLib.daysFromCivil(vm.parseUint(p[0]), vm.parseUint(p[1]), vm.parseUint(p[2]));
        }
    }

    /// @dev Inventory swaps stay disabled (no adapter) unless on local anvil or ADAPTER_ENABLED=true.
    function _adapterEnabled() internal view returns (bool) {
        return block.chainid == 31337 || vm.envOr("ADAPTER_ENABLED", false);
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

/// @notice Mainnet (4663) guarded-beta deploy. Addresses from config/4663.json, launch settings
///         (caps, fee, NYSE holidays) from config/launch-4663.json. Refuses any other chain,
///         re-checks symbol/decimals/bytecode, and verifies every setting after deploying.
///
///   OWNER=<Safe address> KEEPER=<keeper EOA> [FEE_RECIPIENT=<addr, default OWNER>] \
///   forge script script/Deploy.s.sol:DeployMainnet --rpc-url robinhood --broadcast \
///     --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
///
/// Omit --broadcast (and --verify) for a dry run against live mainnet state.
/// OWNER must be a contract (the Safe) unless ALLOW_EOA_OWNER=true. After broadcasting, the
/// Safe must call acceptOwnership() on the oracle, vault and market (Ownable2Step).
contract DeployMainnet is DeployBase {
    struct Addrs {
        address usdg;
        address nvda;
        address feed;
        address factory;
        address pool;
        uint24 feeTier;
    }

    struct Launch {
        uint256 depositCap; // USDG, 6 dec
        uint256 maxNotional; // USDG, 6 dec
        uint256 takerFeeBps;
        uint256[] holidays; // UTC day indices
    }

    struct Roles {
        address owner;
        address keeper;
        address feeRecipient;
    }

    /// @dev Field order is alphabetical: forge decodes JSON objects with sorted keys.
    struct StockCfg {
        address feed;
        string symbol;
        address token;
    }

    function run() external {
        require(block.chainid == 4663, "DeployMainnet: chainid != 4663");
        Addrs memory a = _loadAddrs();
        Launch memory l = _loadLaunch();
        Roles memory r = _loadRoles();
        StockCfg[] memory stocks = _loadStocks();
        _checkLive(a);
        for (uint256 i; i < stocks.length; ++i) {
            _checkStock(stocks[i]);
        }

        vm.startBroadcast();
        Core memory c = _deployCore(a.usdg, a.nvda, a.feed, r.feeRecipient, l.holidays);
        c.oracle.setKeeper(r.keeper, true);
        c.vault.setKeeper(r.keeper, true);
        c.market.setKeeper(r.keeper, true);
        c.vault.setDepositCap(l.depositCap);
        c.market.setFeeParams(r.feeRecipient, l.takerFeeBps, l.maxNotional);
        // Every listed ticker gets a feed and market access. NVDA (the vault's stock) is already wired.
        for (uint256 i; i < stocks.length; ++i) {
            if (stocks[i].token == a.nvda) continue;
            c.oracle.setFeed(stocks[i].token, stocks[i].feed);
            c.market.setStockAllowed(stocks[i].token, true);
        }
        address adapter;
        if (_adapterEnabled()) {
            adapter = address(new UniswapV3PoolAdapter(a.factory, a.feeTier));
            c.vault.setSwapAdapter(adapter);
        } else {
            console2.log("swap adapter NOT set (ADAPTER_ENABLED!=true): vault inventory swaps disabled");
        }
        _handOver(c, r.owner);
        vm.stopBroadcast();

        _verify(c, a, l, r, adapter);
        for (uint256 i; i < stocks.length; ++i) {
            require(c.oracle.feedOf(stocks[i].token) == stocks[i].feed, "stock feed not set");
            require(c.market.stockAllowed(stocks[i].token), "stock not allowed");
        }

        vm.serializeAddress("deployment", "owner", r.owner);
        vm.serializeAddress("deployment", "keeper", r.keeper);
        vm.serializeUint("deployment", "vaultDepositCap", l.depositCap);
        vm.serializeUint("deployment", "maxNotionalPerMarket", l.maxNotional);
        _write(c, a.usdg, a.nvda, a.feed, adapter);

        console2.log("--- guarded beta ---");
        console2.log("vault deposit cap (USDG, 6 dec):", l.depositCap);
        console2.log("max notional per market (USDG, 6 dec):", l.maxNotional);
        console2.log("holidays set:", l.holidays.length);
        console2.log("tickers listed:", c.oracle.stockCount());
        console2.log("NEXT: from the Safe, call acceptOwnership() on oracle, vault and market");
    }

    function _loadAddrs() internal view returns (Addrs memory a) {
        string memory cfg = vm.readFile(string.concat(vm.projectRoot(), "/config/4663.json"));
        a.usdg = vm.parseJsonAddress(cfg, ".usdg");
        a.nvda = vm.parseJsonAddress(cfg, ".nvda");
        a.feed = vm.parseJsonAddress(cfg, ".nvdaFeed");
        a.factory = vm.parseJsonAddress(cfg, ".uniswapV3Factory");
        a.pool = vm.parseJsonAddress(cfg, ".nvdaUsdgPool");
        a.feeTier = uint24(vm.parseJsonUint(cfg, ".uniswapFeeTier"));
    }

    function _loadStocks() internal view returns (StockCfg[] memory s) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/config/stocks-4663.json"));
        s = abi.decode(vm.parseJson(json, ".stocks"), (StockCfg[]));
        require(s.length > 0, "no stocks listed");
    }

    /// @dev Each listed Stock Token must be a live 18-dec token with a positive Chainlink price.
    function _checkStock(StockCfg memory s) internal view {
        require(
            s.token.code.length > 0 && s.feed.code.length > 0, string.concat(s.symbol, ": missing bytecode")
        );
        require(IStockToken(s.token).decimals() == 18, string.concat(s.symbol, ": decimals != 18"));
        require(IStockToken(s.token).uiMultiplier() > 0, string.concat(s.symbol, ": uiMultiplier"));
        uint8 fd = IAggregatorV3(s.feed).decimals();
        require(fd > 0 && fd <= 18, string.concat(s.symbol, ": feed decimals"));
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(s.feed).latestRoundData();
        require(answer > 0 && updatedAt > 0, string.concat(s.symbol, ": feed answer"));
        console2.log(s.symbol, "token symbol:", IStockToken(s.token).symbol());
    }

    function _loadLaunch() internal view returns (Launch memory l) {
        string memory launch = vm.readFile(string.concat(vm.projectRoot(), "/config/launch-4663.json"));
        l.depositCap = vm.parseJsonUint(launch, ".vaultDepositCapUsdg") * 1e6;
        l.maxNotional = vm.parseJsonUint(launch, ".maxNotionalPerMarketUsdg") * 1e6;
        l.takerFeeBps = vm.parseJsonUint(launch, ".takerFeeBps");
        l.holidays = _parseDays(vm.parseJsonStringArray(launch, ".nyseHolidays"));
        require(l.depositCap > 0 && l.maxNotional > 0 && l.takerFeeBps <= 500, "bad launch settings");
    }

    /// @dev Roles: a Safe owns; a separate hot wallet only keeps.
    function _loadRoles() internal view returns (Roles memory r) {
        r.owner = vm.envAddress("OWNER");
        r.keeper = vm.envAddress("KEEPER");
        r.feeRecipient = vm.envOr("FEE_RECIPIENT", r.owner);
        require(
            r.owner != address(0) && r.keeper != address(0) && r.feeRecipient != address(0),
            "zero role address"
        );
        require(r.keeper != r.owner, "KEEPER must differ from OWNER");
        require(
            r.owner.code.length > 0 || vm.envOr("ALLOW_EOA_OWNER", false), "OWNER is not a contract (Safe)"
        );
    }

    /// @dev Live re-verification (brief: "Always re-read symbol(), decimals(), and bytecode on-chain").
    function _checkLive(Addrs memory a) internal view {
        require(
            a.usdg.code.length > 0 && a.nvda.code.length > 0 && a.feed.code.length > 0, "missing bytecode"
        );
        require(IERC20Metadata(a.usdg).decimals() == 6, "USDG decimals != 6");
        require(IStockToken(a.nvda).decimals() == 18, "NVDA decimals != 18");
        require(IStockToken(a.nvda).uiMultiplier() > 0, "NVDA uiMultiplier");
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(a.feed).latestRoundData();
        require(answer > 0 && updatedAt > 0, "feed");
        require(IAggregatorV3(a.feed).decimals() == 8, "feed decimals != 8");
        // The adapter resolves the pool via the factory; it must be the configured 0.05% NVDA/USDG pool.
        require(IUniswapV3Factory(a.factory).getPool(a.usdg, a.nvda, a.feeTier) == a.pool, "pool mismatch");
        console2.log("USDG", IERC20Metadata(a.usdg).symbol());
        console2.log("NVDA", IStockToken(a.nvda).symbol(), "feed decimals", IAggregatorV3(a.feed).decimals());
    }

    /// @dev Post-conditions: fail loudly rather than ship a half-configured protocol.
    function _verify(Core memory c, Addrs memory a, Launch memory l, Roles memory r, address adapter)
        internal
        view
    {
        require(
            c.oracle.isKeeper(r.keeper) && c.vault.isKeeper(r.keeper) && c.market.isKeeper(r.keeper),
            "keeper not set"
        );
        require(c.vault.depositCap() == l.depositCap, "deposit cap not set");
        require(
            c.market.maxNotionalLimit() == l.maxNotional && c.market.takerFeeBps() == l.takerFeeBps,
            "market caps"
        );
        require(
            c.market.feeRecipient() == r.feeRecipient && c.vault.feeRecipient() == r.feeRecipient,
            "fee recipient"
        );
        require(address(c.vault.swapAdapter()) == adapter, "adapter");
        require(c.market.stockAllowed(a.nvda) && c.oracle.feedOf(a.nvda) == a.feed, "wiring");
        for (uint256 i; i < l.holidays.length; ++i) {
            require(c.oracle.isHoliday(l.holidays[i]), "holiday not set");
        }
        if (r.owner != msg.sender) {
            require(
                c.oracle.pendingOwner() == r.owner && c.vault.pendingOwner() == r.owner
                    && c.market.pendingOwner() == r.owner,
                "ownership not pending to OWNER"
            );
        }
    }
}

/// @notice Mock deploy (mocks implement uiMultiplier, balanceOfUI and oraclePaused). Seeds an NVDA
///         feed round at block time and demo balances for anvil accounts #0 (owner), #1 and #2.
abstract contract DeployMocks is DeployBase {
    /// @dev A mock Stock Token + 8-dec feed seeded at block time, registered and market-allowed.
    function _mockTicker(Core memory c, string memory name, string memory symbol, int256 px8) internal {
        MockStockToken t = new MockStockToken(name, symbol);
        MockAggregator f = new MockAggregator(8, string.concat(symbol, " / USD (mock)"));
        f.setAnswer(px8);
        c.oracle.setFeed(address(t), address(f));
        c.market.setStockAllowed(address(t), true);
    }

    address internal constant USER1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant USER2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function _deployMocks() internal {
        address deployer = msg.sender;

        vm.startBroadcast();
        MockUSDG usdg = new MockUSDG();
        MockStockToken nvda = new MockStockToken("NVIDIA Stock Token (mock)", "NVDA");
        MockAggregator feed = new MockAggregator(8, "NVDA / USD (mock)");
        MockSwapAdapter mockVenue = new MockSwapAdapter(address(usdg), address(nvda), 180e18);

        // Seed a price so the oracle has a mark. The round is stamped at block time.
        feed.setAnswer(180_00000000);

        Core memory c = _deployCore(address(usdg), address(nvda), address(feed), deployer, _defaultHolidays());
        address adapter;
        if (_adapterEnabled()) {
            adapter = address(mockVenue);
            c.vault.setSwapAdapter(adapter);
        }
        c.vault.setKeeper(deployer, true);
        c.market.setKeeper(deployer, true);
        c.oracle.setKeeper(deployer, true);

        address[3] memory demo = [deployer, USER1, USER2];
        for (uint256 i; i < demo.length; ++i) {
            usdg.mint(demo[i], 10_000e6);
            nvda.mint(demo[i], 2e18);
        }

        // More tickers (mocks), deployed last so the demo's earlier addresses never move.
        _mockTicker(c, "Apple Stock Token (mock)", "AAPL", 230_00000000);
        _mockTicker(c, "SPDR S&P 500 Stock Token (mock)", "SPY", 660_00000000);
        _mockTicker(c, "Tesla Stock Token (mock)", "TSLA", 410_00000000);
        _mockTicker(c, "Microsoft Stock Token (mock)", "MSFT", 510_00000000);
        vm.stopBroadcast();

        // Recorded even when not wired as the adapter, so the demo can move its price alongside the feed.
        vm.serializeAddress("deployment", "mockVenue", address(mockVenue));
        _write(c, address(usdg), address(nvda), address(feed), adapter);
    }
}

/// @notice Local anvil (31337) deploy used by script/local-demo.sh. Inventory swaps enabled via the mock venue.
/// forge script script/Deploy.s.sol:DeployLocal --rpc-url local --broadcast
contract DeployLocal is DeployMocks {
    function run() external {
        require(block.chainid == 31337, "DeployLocal: chainid != 31337");
        _deployMocks();
    }
}

/// @notice Robinhood testnet (46630) deploy with mocks. Inventory swaps are disabled unless ADAPTER_ENABLED=true.
/// forge script script/Deploy.s.sol:DeployTestnet --rpc-url robinhood_testnet --broadcast
contract DeployTestnet is DeployMocks {
    function run() external {
        require(block.chainid == 46630, "DeployTestnet: chainid != 46630");
        _deployMocks();
    }
}
