{ pkgs ? import (fetchTarball {
    url = "https://channels.nixos.org/nixos-24.05/nixexprs.tar.xz";
  }) {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.docker
    pkgs.docker-compose
    pkgs.git

    # Orchestrator
    pkgs.bun
    pkgs.yarn
    pkgs.nodePackages.typescript-language-server
    pkgs.vscode-langservers-extracted
  ];
}
