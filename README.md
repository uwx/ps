# @pkmn/ps

> [Pokémon Showdown][0], [modularized into packages][1].

This is the top level of @pkmn's Pokémon Showdown components:

- [`@pkmn/sim`][2]: an automatically generated extraction of just the simulator portion of [smogon/pokemon-showdown][3]
- [`@pkmn/types`][4]: TypeScript definitions for types common to Pokémon projects
- [`@pkmn/protocol`][5]: Parsing logic for Pokémon Showdown's [PROTOCOL][6] and [SIM-PROTOCOL][7].
- [`@pkmn/client`][8]: a forked implementation of [smogon/pokemon-showdown-client][9]'s battle engine, build on top of `@pkmn/protocol`.

Everything is distributed under the terms of the [MIT License][10], where substantial
amounts of the code have been either derived or generated from the portions of Guangcong
Luo's Pokémon Showdown [server][3] and [client][9] which are also distributed under the [MIT License][11].

  [0]: https://pokemonshowdown.com
  [1]: https://pkmn.cc/modular-ps
  [2]: https://github.com/pkmn/ps/blob/master/sim
  [3]: https://github.com/smogon/pokemon-showdown
  [5]: https://github.com/pkmn/ps/blob/master/types
  [6]: https://github.com/pkmn/ps/blob/master/protocol
  [7]: https://github.com/smogon/pokemon-showdown/blob/master/PROTOCOL.md
  [8]: https://github.com/smogon/pokemon-showdown/blob/master/sim/SIM-PROTOCOL.md
  [9]: https://github.com/pkmn/ps/blob/master/client
  [10]: https://github.com/smogon/pokemon-showdown-client
  [11]: https://github.com/pkmn/ps/blob/master/LICENSE
  [12]: https://github.com/smogon/pokemon-showdown/blob/master/LICENSE
