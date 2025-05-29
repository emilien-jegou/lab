{ pkgs ? import (fetchTarball {
    url = "https://channels.nixos.org/nixos-25.05/nixexprs.tar.xz";
  }) {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.docker
    pkgs.docker-compose
    pkgs.git

    # Orchestrator
    pkgs.redisinsight
    pkgs.bun
    pkgs.yarn
    pkgs.nodePackages.typescript-language-server
    pkgs.vscode-langservers-extracted
  ];
}
