# One image, two Railway services (build context = repo root):
#   default           public Amen demo chain: anvil (chain id 31337, mocks only, no real funds)
#                     running ./script/local-demo.sh, rewound to Friday 16:02 New York.
#   AMEN_SERVICE=keeper  the mainnet keeper bot (keeper/src/keeper.mjs), configured by its env vars.
# Railway applies the root railway.json to every service from this repo, so the variable picks the role.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates curl git jq tzdata procps \
 && rm -rf /var/lib/apt/lists/*

# Foundry (forge, cast, anvil)
ENV FOUNDRY_DIR=/opt/foundry PATH=/opt/foundry/bin:$PATH
RUN curl -sSL https://foundry.paradigm.xyz | bash && foundryup

WORKDIR /app
COPY . .

# Submodules may not be included in the build context; fetch the pinned versions if missing.
RUN if [ ! -f lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol ]; then \
      rm -rf lib/openzeppelin-contracts && git clone -q --depth 1 --branch v5.1.0 \
        https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts; fi; \
    if [ ! -f lib/forge-std/src/Test.sol ]; then \
      rm -rf lib/forge-std && git clone -q --depth 1 --branch v1.9.7 \
        https://github.com/foundry-rs/forge-std lib/forge-std; fi

# Compile at build time so startup only deploys.
RUN forge build

# Keeper dependencies (only used when AMEN_SERVICE=keeper).
RUN cd keeper && npm ci --omit=dev

ENV ANVIL_HOST=0.0.0.0 TZ=UTC
# Render/Railway/Fly inject PORT; default 8545.
CMD ["bash", "-c", "if [ \"$AMEN_SERVICE\" = keeper ]; then cd keeper && exec node src/keeper.mjs; else ANVIL_PORT=${PORT:-8545} exec ./script/local-demo.sh --serve; fi"]
