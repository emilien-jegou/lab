{ pkgs ? import (fetchTarball {
    url = "https://channels.nixos.org/nixos-25.05/nixexprs.tar.xz";
  }) {} }:

let
    rust-overlay = import (builtins.fetchTarball {
    url = "https://github.com/oxalica/rust-overlay/archive/master.tar.gz";
  });


  pkgs = import <nixpkgs> {
    overlays = [ rust-overlay ];
  };
in
pkgs.mkShell {
  buildInputs = [
    pkgs.podman
    pkgs.podman-compose
    pkgs.git
    pkgs.valkey

    # walrus
    (pkgs.rust-bin.nightly."2026-02-02".default.override {
      extensions = ["rust-src" "rustfmt" "rust-analyzer" "clippy"];
      targets = ["wasm32-unknown-unknown" "x86_64-unknown-linux-gnu" ];
    })

    # Orchestrator
    pkgs.bun
    pkgs.yarn
    pkgs.nodePackages.typescript-language-server
    pkgs.vscode-langservers-extracted
  ];
}
