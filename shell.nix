{ pkgs ? import (fetchTarball {
    url = "https://channels.nixos.org/nixos-25.05/nixexprs.tar.xz";
  }) {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.podman
    pkgs.podman-compose
    pkgs.git
    pkgs.sqlite-web
    pkgs.valkey

    # Orchestrator
    pkgs.bun
    pkgs.yarn
    pkgs.nodePackages.typescript-language-server
    pkgs.vscode-langservers-extracted
  ];
}
