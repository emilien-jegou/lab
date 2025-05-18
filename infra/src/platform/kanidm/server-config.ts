// Renders the Kanidm server.toml configuration file.
export const renderServerToml = (domain: string, origin: string): string =>
  `
domain = "${domain}"
origin = "${origin}"
bindaddress = "0.0.0.0:8443"
ldapbindaddress = "0.0.0.0:3636"
db_path = "/data/kanidm.db"
tls_chain = "/certs/chain.pem"
tls_key = "/certs/key.pem"
log_level = "info"

[online_backup]
path = "/data/backups"
schedule = "0 0 22 * * *"
`.trim();
