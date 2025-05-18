{ pkgs, config, ... }:

{
  packages = [
    pkgs.bun
    pkgs.valkey
    pkgs.docker-compose
    pkgs.openssl
  ];

  # 1. Runtimes
  languages.typescript.enable = true;
  languages.javascript = {
    enable = true;
    npm.enable = true;
    package = pkgs.nodejs_22;
  };

  # 2. Centralized Stack Environment Variables
  env = {
    # OpenRouter
    OPENROUTER_MODEL = "inclusionai/ling-3.0-flash";
    OPENROUTER_MAX_PROMPT_PRICE_PER_M = "0.022";
    OPENROUTER_MAX_COMPLETION_PRICE_PER_M = "0.064";
    OPENROUTER_PROVIDER = "Novita";

    # Kanidm IAM Credentials (used by kanidmd on first boot database creation)
    KANIDM_IDM_ADMIN_PASSWORD = "zafrqcwharjx64f8xatwbt8x3tdej3hbr95h324ttug3ketj";
    DEV_USER_PASSWORD = "ChangeMeDev123!";

    # Valkey Cache
    VALKEY_PASSWORD = "changeme";

    # Iggy Event Bus
    IGGY_ROOT_USERNAME = "iggy";
    IGGY_ROOT_PASSWORD = "iggy";

    # SurrealDB Multi-Model Database
    SURREALDB_ROOT_PASSWORD = "root";

    # PostgreSQL (OxiCloud Database)
    POSTGRES_USER = "oxicloud";
    POSTGRES_DB = "oxicloud";
    POSTGRES_PASSWORD = "oxicloud_secret_password";

    # OpenObserve Observability Hub
    ZO_ROOT_USER_EMAIL = "admin@example.com";
    ZO_ROOT_USER_PASSWORD = "ChangeMe123!";

    # Ingress & OAuth2-Proxy Cookie Encryption Secrets
    OAUTH2_PROXY_COOKIE_SECRET = "c3VwZXJzZWNyZXRjb29raWVrZXkxMjM0NTY3ODkwMTI=";
    MATERIALIOUS_COOKIE_SECRET = "bb1c08f0d6a007788ffa950e023048553082abdedb6af9ff14bafdd106f05339";
  };

  # 3. Development CLI Helper Commands
scripts = {
    "dev-init".exec = ''
      cd infra && bun run provision "$@"
    '';

    "dev-plan".exec = ''
      cd infra && bun run plan "$@"
    '';

    "dev-deploy".exec = ''
      cd infra && bun run deploy "$@"
    '';

    "dev-valkey-cli".exec = ''
      valkey-cli -h 127.0.0.1 -p 6379 ''${VALKEY_PASSWORD:+-a "$VALKEY_PASSWORD"} "$@"
    '';

    "dev-surreal-sql".exec = ''
      docker exec -it surrealdb /surreal sql --endpoint http://127.0.0.1:6800 --user root --pass "$SURREALDB_ROOT_PASSWORD" "$@"
    '';

    "dev".exec = ''
      echo "Available lab helper commands:"
      echo "  dev-init       - Provision OAuth2 clients in Kanidm & sync secrets 🔑"
      echo "  dev-plan       - Run Alchemy stack preview / dry-run 📋"
      echo "  dev-deploy     - Deploy and reconcile the Alchemy homelab stack 🚀"
      echo "  dev-valkey-cli - Connect to Valkey with local credentials 🗄️"
      echo "  dev-surreal-sql- Open SurrealDB SQL prompt 🔍"
      echo "  dev            - Show this helper 💡"
    '';
  };

  enterShell = ''dev'';
}
