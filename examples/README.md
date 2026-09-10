Project Examples
================

Copy an example into your repository as vdb.json and assign stable package IDs.
These examples do not register projects or alter installed mods automatically.

Before deployment, inspect the actual game's mod type and staging layout. Set
modType to the existing Vortex mod type ID when it differs from the default. The
bridge takes a prepared directory, bypassing archive installer inference. A BepInEx
plugin folder and a game-root payload are not interchangeable layouts.

The Sovereign example keeps textures separate. It does not claim the main package's
mod/ and mods/ layout works with every Elden Ring installer/mod type. Qualify that
mapping using a disposable profile before changing production scripts.

Register with `node client/vdb.cjs register --config <path-to-vdb.json>` from an
installed package, or `node src/client/cli.js register --config <path>` from source.
