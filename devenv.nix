{ pkgs, config, ... }:

{
  packages = [
    pkgs.bun
    pkgs.valkey
    pkgs.docker-compose
  ];

  # 1. Runtimes
  languages.typescript.enable = true;
  languages.javascript = {
    enable = true;
    npm.enable = true;
    package = pkgs.nodejs_22;
  };

  env = {
    OPENROUTER_MODEL = "inclusionai/ling-3.0-flash";
    #OPENROUTER_API_KEY = config.secretspec.secrets.OPENROUTER_API_KEY;
    OPENROUTER_MAX_PROMPT_PRICE_PER_M = "0.022";
    OPENROUTER_MAX_COMPLETION_PRICE_PER_M = "0.064";
    OPENROUTER_PROVIDER = "Novita";
  };

  scripts = {
    "lab-idm-gen-admin-pass".exec = ''
      docker compose exec -it kanidm kanidmd recover-account -c /etc/kanidm/server.toml admin
    '';

    "lab-idm-gen-idm-admin-pass".exec = ''
      docker compose exec -it kanidm kanidmd recover-account -c /etc/kanidm/server.toml idm_admin
    '';

    "lab-valkey-cli".exec = ''
      if [ -f env/valkey.env ]; then
        set -a
        source env/valkey.env
        set +a
      fi
      valkey-cli -h 127.0.0.1 -p 6379 ''${VALKEY_PASSWORD:+-a "$VALKEY_PASSWORD"} "$@"
    '';

    "lab-surreal-sql".exec = ''
      docker compose exec -it surrealdb /surreal sql --endpoint http://127.0.0.1:8000 --user root "$@"
    '';

    "lab-help".exec = ''
      echo "Available lab helper commands:"
      echo "  lab-idm-gen-admin-pass     - Generate password for Kanidm admin"
      echo "  lab-idm-gen-idm-admin-pass - Generate password for Kanidm idm_admin"
      echo "  lab-valkey-cli             - Connect to Valkey with local credentials"
      echo "  lab-surreal-sql            - Open SurrealDB SQL prompt"
      echo "  lab-help                   - Show this helper 💡"
    '';
  };

  enterShell = ''
    lab-help
  '';
}
