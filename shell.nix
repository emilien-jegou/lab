{ pkgs ? import (fetchTarball {
    url = "https://channels.nixos.org/nixos-24.05/nixexprs.tar.xz";
  }) {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.docker
    pkgs.docker-compose
    pkgs.git
  ];
}
