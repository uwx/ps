import { Protocol, ArgType, Args, KWArgs, KWArgType } from '@pkmn/protocol';
import { As, ID, StatName, GenerationNum } from '@pkmn/types';
import * as TextJSON from '../data/text.json';

const Text = TextJSON as {
  default: { [templateName: string]: string },
  [id: string]: { [templateName: string]: string },
} & {
    [s in StatName]: { statName: string, statShortName: string }
  };

function toID(s: string): ID {
  return ('' + s).toLowerCase().replace(/[^a-z0-9]+/g, '') as ID;
}

type Output = '' & As<'Output'>;

const VALS = ['pokemon', 'opposingPokemon', 'team', 'opposingTeam', 'party', 'opposingParty']; // TODO rename

export class TextParser implements Protocol.Handler<Output> {
  #out: (s: string) => void;
  #perspective: 0 | 1;

  #p1: Protocol.Username;
  #p2: Protocol.Username;
  #gen: GenerationNum;

  #curLineSection: 'break' | 'preMajor' | 'major' | 'postMajor';
  #lowercaseRegExp: RegExp | null | undefined;

  constructor(out: (s: string) => void, perspective: 0 | 1 = 0) {
    this.#out = out;
    this.#perspective = perspective;

    this.#p1 = 'Player 1' as Protocol.Username;
    this.#p2 = 'Player 2' as Protocol.Username;
    this.#gen = 8;

    this.#curLineSection = 'break';
    this.#lowercaseRegExp = undefined;
  }

  fixLowercase(input: string) {
    if (this.#lowercaseRegExp === undefined) {
      const prefixes = VALS.map(templateId => {
        const template = Text.default[templateId];
        if (template.charAt(0) === template.charAt(0).toUpperCase()) return '';
        const bracketIndex = template.indexOf('[');
        return bracketIndex >= 0 ? template.slice(0, bracketIndex) : template;
      }).filter(prefix => prefix);
      if (prefixes.length) {
        const buf = `((?:^|\n)(?:  |  \\\(|\\\[)?)(` +
          prefixes.map(TextParser.escapeRegExp).join('|') +
          `)`;
        this.#lowercaseRegExp = new RegExp(buf, 'g');
      } else {
        this.#lowercaseRegExp = null;
      }
    }
    if (!this.#lowercaseRegExp) return input;
    return input.replace(this.#lowercaseRegExp, (_, p1, p2) => (
      p1 + p2.charAt(0).toUpperCase() + p2.slice(1)
    ));
  }

  static escapeRegExp(input: string) {
    return input.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }

  pokemonName(pokemon: Protocol.PokemonIdent) {
    if (!pokemon) return '';
    if (!pokemon.startsWith('p1') && !pokemon.startsWith('p2')) return `???pokemon:${pokemon}???`;
    if (pokemon.charAt(3) === ':') return pokemon.slice(4).trim();
    else if (pokemon.charAt(2) === ':') return pokemon.slice(3).trim();
    return `???pokemon:${pokemon}???`;
  }

  pokemon(pokemon: Protocol.PokemonIdent) {
    if (!pokemon) return '';
    let side;
    switch (pokemon.slice(0, 2)) {
      case 'p1': side = 0; break;
      case 'p2': side = 1; break;
      default: return `???pokemon:${pokemon}???`;
    }
    const name = this.pokemonName(pokemon);
    const template = Text.default[side === this.#perspective ? 'pokemon' : 'opposingPokemon'];
    return template.replace('[NICKNAME]', name);
  }

  pokemonFull(pokemon: Protocol.PokemonIdent, details: Protocol.PokemonDetails): [string, string] {
    const nickname = this.pokemonName(pokemon);

    const species = details.split(',')[0];
    if (nickname === species) return [pokemon.slice(0, 2), `**${species}**`];
    return [pokemon.slice(0, 2), `${nickname} (**${species}**)`];
  }

  trainer(side: string) {
    side = side.slice(0, 2);
    if (side === 'p1') return this.#p1;
    if (side === 'p2') return this.#p2;
    return `???side:${side}???`;
  }

  team(side: string) {
    side = side.slice(0, 2);
    if (side === (this.#perspective === 0 ? 'p1' : 'p2')) {
      return Text.default.team;
    }
    return Text.default.opposingTeam;
  }

  own(side: string) {
    side = side.slice(0, 2);
    if (side === (this.#perspective === 0 ? 'p1' : 'p2')) {
      return 'OWN';
    }
    return '';
  }

  party(side: string) {
    side = side.slice(0, 2);
    if (side === (this.#perspective === 0 ? 'p1' : 'p2')) {
      return Text.default.party;
    }
    return Text.default.opposingParty;
  }

  static effectId(effect?: string) {
    return Protocol.parseEffect(effect, toID).name as ID;
  }

  effect(effect?: string) {
    return Protocol.parseEffect(effect).name;
  }

  template(type: string, ...namespaces: (string | undefined)[]) {
    for (const namespace of namespaces) {
      if (!namespace) continue;
      if (namespace === 'OWN') return `${Text.default[type + 'Own']}\n`;
      if (namespace === 'NODEFAULT') return '';
      let id = TextParser.effectId(namespace);
      if (Text[id] && type in Text[id]) {
        if (Text[id][type].charAt(1) === '.') type = Text[id][type].slice(2) as ID;
        if (Text[id][type].charAt(0) === '#') id = Text[id][type].slice(1) as ID;
        if (!Text[id][type]) return '';
        return `${Text[id][type]}\n`;
      }
    }
    if (!Text.default[type]) return '';
    return `${Text.default[type]}\n`;
  }

  maybeAbility(effect: string | undefined, holder: Protocol.PokemonIdent) {
    if (!effect) return '';
    if (!effect.startsWith('ability:')) return '';
    return this.ability(effect.slice(8).trim(), holder);
  }

  ability(name: string | undefined, holder: Protocol.PokemonIdent) {
    if (!name) return '';
    return (Text.default.abilityActivation
      .replace('[POKEMON]', this.pokemon(holder))
      .replace('[ABILITY]', this.effect(name)) + '\n');
  }

  stat(stat: StatName) {
    const entry = Text[stat || 'stats'];
    if (!entry || !entry.statName) return `???stat:${stat}???`;
    return entry.statName;
  }

  lineSection(args: ArgType, kwArgs: KWArgType) {
    const cmd = args[0];
    switch (cmd) {
      case 'done': case 'turn':
        return 'break';
      case 'move': case 'cant': case 'switch':case 'drag':
      case 'upkeep': case 'start': case '-mega':
        return 'major';
      case 'faint': case 'switchout':
        return 'preMajor';
      case '-zpower':
        return 'postMajor';
      case '-damage': {
        const id = TextParser.effectId((kwArgs as KWArgs['-damage']).from);
        return id === 'confusion' ? 'major' : 'postMajor';
      }
      case '-curestatus': {
        const id = TextParser.effectId((kwArgs as KWArgs['-curestatus']).from);
        return id === 'naturalcure' ? 'preMajor' : 'postMajor';
      }
      case '-start': {
        const id = TextParser.effectId((kwArgs as unknown as KWArgs['-start']).from);
        return id === 'protean' ? 'preMajor' : 'postMajor';
      }
      case '-activate': {
        const id = TextParser.effectId((args as Args['-activate'])[2]);
        return id === 'confusion' || id === 'attract' ? 'preMajor' : 'postMajor';
      }
    }
    return (cmd.charAt(0) === '-' ? 'postMajor' : '');
  }

  sectionBreak(args: ArgType, kwArgs = {} as KWArgType) {
    const prevSection = this.#curLineSection;
    const curSection = this.lineSection(args, kwArgs);
    if (!curSection) return false;
    this.#curLineSection = curSection;
    switch (curSection) {
      case 'break':
        return prevSection !== 'break';
      case 'preMajor':
      case 'major':
        return prevSection === 'postMajor' || prevSection === 'major';
      case 'postMajor':
        return false;
    }
  }

  // FIXME default....
  out(s: string, args: ArgType, kwArgs?: KWArgType, noSectionBreak?: boolean) {
    const buf = !noSectionBreak && this.sectionBreak(args, kwArgs) ? '\n' : '';
    this.#out(buf + this.fixLowercase(s || ''));
    return '' as Output;
  }

  'player'(args: Args['player']) {
    const [, side, name] = args;
    if (side === 'p1' && name) {
      this.#p1 = name;
    } else if (side === 'p2' && name) {
      this.#p2 = name;
    }
    return this.out('', args);
  }

  'gen'(args: Args['gen']) {
    const [, gen] = args;
    this.#gen = gen;
    return this.out('', args);
  }


  'turn'(args: Args['turn']) {
    const [, num] = args;
    return this.out(this.template('turn').replace('[NUMBER]', num) + '\n', args);
  }

  'start'(args: Args['start']) {
    return this.out(this.template('startBattle')
      .replace('[TRAINER]', this.#p1)
      .replace('[TRAINER]', this.#p2),
      args);
  }

  'win'(args: Args['win']) {
    return this.finish(args);
  }

  'tie'(args: Args['tie']) {
    return this.finish(args);
  }

  'switch'(args: Args['switch']) {
    const [, pokemon, details] = args;
    const [side, fullname] = this.pokemonFull(pokemon, details);
    const template = this.template('switchIn', this.own(side));
    return this.out(template
      .replace('[TRAINER]', this.trainer(side))
      .replace('[FULLNAME]', fullname),
      args);
  }

  'drag'(args: Args['drag']) {
    const [, pokemon, details] = args;
    const [side, fullname] = this.pokemonFull(pokemon, details);
    const template = this.template('drag');
    return this.out(template
      .replace('[TRAINER]', this.trainer(side))
      .replace('[FULLNAME]', fullname), args);
  }

  'detailschange'(args: Args['detailschange'], kwArgs: KWArgs['detailschange']) {
    return this.change(args, kwArgs);
  }

  '-transform'(args: Args['-transform'], kwArgs: KWArgs['-transform']) {
    return this.change(args, kwArgs);
  }

  '-formechange'(args: Args['-formechange'], kwArgs: KWArgs['-formechange']) {
    return this.change(args, kwArgs);
  }

  'switchout'(args: Args['switchout'], kwArgs: KWArgs['switchout']) {
    const [, pokemon] = args;
    const side = pokemon.slice(0, 2);
    const template = this.template('switchOut', kwArgs.from, this.own(side));
    return this.out(template
      .replace('[TRAINER]', this.trainer(side))
      .replace('[NICKNAME]', this.pokemonName(pokemon))
      .replace('[POKEMON]', this.pokemon(pokemon)),
      args, kwArgs);
  }

  'faint'(args: Args['faint']) {
    const [, pokemon] = args;
    const template = this.template('faint');
    return this.out(template.replace('[POKEMON]', this.pokemon(pokemon)), args);
  }

  'swap'(args: Args['swap']) {
    const [, pokemon, target] = args;
    if (!target || !isNaN(Number(target))) {
      const template = this.template('swapCenter');
      return this.out(template.replace('[POKEMON]', this.pokemon(pokemon)), args);
    }
    const template = this.template('swap');
    return this.out(template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[TARGET]', this.pokemon(target)),
      args);
  }

  'move'(args: Args['move'], kwArgs: KWArgs['move']) {
    const [, pokemon, move] = args;
    let line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    if (kwArgs.zEffect) {
      line1 = this.template('zEffect').replace('[POKEMON]', this.pokemon(pokemon));
    }
    const template = this.template('move', kwArgs.from);
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[MOVE]', move),
      args, kwArgs);
  }

  'cant'(args: Args['cant'], kwArgs: KWArgs['cant']) {
    let [, pokemon, effect, move] = args;
    const template = this.template('cant', effect, 'NODEFAULT') ||
      this.template(move ? 'cant' : 'cantNoMove');
    const line1 = this.maybeAbility(effect, kwArgs.of || pokemon);
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[MOVE]', move),
      args, kwArgs)
  }

  '-start'(args: Args['-start'], kwArgs: KWArgs['-start']) {
    let [, pokemon, effect, arg3] = args;
    const line1 = this.maybeAbility(effect, pokemon)
      || this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    let id = TextParser.effectId(effect);
    if (id === 'typechange') {
      const template = this.template('typeChange', kwArgs.from);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[TYPE]', arg3)
        .replace('[SOURCE]', this.pokemon(kwArgs.of)),
        args, kwArgs);
    }
    if (id === 'typeadd') {
      const template = this.template('typeAdd', kwArgs.from);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[TYPE]', arg3),
        args, kwArgs);
    }
    if (id.startsWith('stockpile')) {
      const num = id.slice(9);
      const template = this.template('start', 'stockpile');
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[NUMBER]', num),
        args, kwArgs);
    }
    if (id.startsWith('perish')) {
      const num = id.slice(6);
      const template = this.template('activate', 'perishsong');
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[NUMBER]', num),
        args, kwArgs);
    }
    let templateId = 'start';
    if (kwArgs.already) templateId = 'alreadyStarted';
    if (kwArgs.fatigue) templateId = 'startFromFatigue';
    if (kwArgs.zeffect) templateId = 'startFromZEffect';
    if (kwArgs.damage) templateId = 'activate';
    if (kwArgs.block) templateId = 'block';
    if (kwArgs.upkeep) templateId = 'upkeep';
    if (id === 'reflect' || id === 'lightscreen') templateId = 'startGen1';
    if (templateId === 'start' && kwArgs.from?.startsWith('item:')) {
      templateId += 'FromItem';
    }
    const template = this.template(templateId, effect);
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[EFFECT]', this.effect(effect))
      .replace('[MOVE]', arg3).replace('[SOURCE]', this.pokemon(kwArgs.of))
      .replace('[ITEM]', this.effect(kwArgs.from)),
      args, kwArgs);
  }

  '-end'(args: Args['-end'], kwArgs: KWArgs['-end']) {
    let [, pokemon, effect] = args;
    const line1 = this.maybeAbility(effect, pokemon)
      || this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    let id = TextParser.effectId(effect);
    if (id === 'doomdesire' || id === 'futuresight') {
      const template = this.template('activate', effect);
      return this.out(line1 + template.replace('[TARGET]', this.pokemon(pokemon)), args, kwArgs);
    }
    let templateId = 'end';
    let template = '';
    if (kwArgs.from?.startsWith('item:')) {
      template = this.template('endFromItem', effect);
    }
    if (!template) template = this.template(templateId, effect);
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[EFFECT]', this.effect(effect))
      .replace('[SOURCE]', this.pokemon(kwArgs.of)),
      args, kwArgs);
  }

  '-ability'(args: Args['-ability'], kwArgs: KWArgs['-ability']) {
    let [, pokemon, ability, oldAbility, arg4] = args;
    let line1 = '';
    if (oldAbility && (oldAbility.startsWith('p1')
      || oldAbility.startsWith('p2')
      || oldAbility === 'boost')) {
      arg4 = oldAbility;
      oldAbility = '';
    }
    if (oldAbility) line1 += this.ability(oldAbility, pokemon);
    line1 += this.ability(ability, pokemon);
    if (kwArgs.fail) {
      const template = this.template('block', kwArgs.from);
      return this.out(line1 + template, args, kwArgs);
    }
    if (kwArgs.from) {
      line1 = this.maybeAbility(kwArgs.from, pokemon) + line1;
      const template = this.template('changeAbility', kwArgs.from);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[ABILITY]', this.effect(ability))
        .replace('[SOURCE]', this.pokemon(kwArgs.of)),
        args, kwArgs);
    }
    const id = TextParser.effectId(ability);
    if (id === 'unnerve') {
      const template = this.template('start', ability);
      return this.out(line1 + template.replace('[TEAM]', this.team(arg4)), args, kwArgs);
    }
    let templateId = 'start';
    if (id === 'anticipation' || id === 'sturdy') templateId = 'activate';
    const template = this.template(templateId, ability, 'NODEFAULT');
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  '-endability'(args: Args['-endability'], kwArgs: KWArgs['-endability']) {
    let [, pokemon, ability] = args;
    if (ability) return this.out(this.ability(ability, pokemon), args, kwArgs);
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    const template = this.template('start', 'Gastro Acid');
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  '-item'(args: Args['-item'], kwArgs: KWArgs['-item']) {
    const [, pokemon, item] = args;
    const id = TextParser.effectId(kwArgs.from);
    let target = '';
    if (['magician', 'pickpocket'].includes(id)) {
      [target, kwArgs.of] = [kwArgs.of, ''];
    }
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    if (['thief', 'covet', 'bestow', 'magician', 'pickpocket'].includes(id)) {
      const template = this.template('takeItem', kwArgs.from);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[ITEM]', this.effect(item))
        .replace('[SOURCE]', this.pokemon(target || kwArgs.of)),
        args, kwArgs);
    }
    if (id === 'frisk') {
      const hasTarget = kwArgs.of && pokemon && kwArgs.of !== pokemon;
      const template = this.template(hasTarget ? 'activate' : 'activateNoTarget', "Frisk");
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(kwArgs.of))
        .replace('[ITEM]', this.effect(item))
        .replace('[TARGET]', this.pokemon(pokemon)),
        args, kwArgs);
    }
    if (kwArgs.from) {
      const template = this.template('addItem', kwArgs.from);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[ITEM]', this.effect(item)),
        args, kwArgs);
    }
    const template = this.template('start', item, 'NODEFAULT');
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  '-enditem'(args: Args['-enditem'], kwArgs: KWArgs['-enditem']) {
    let [, pokemon, item] = args;
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    if (kwArgs.eat) {
      const template = this.template('eatItem', kwArgs.from);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[ITEM]', this.effect(item)),
        args, kwArgs);;
    }
    const id = TextParser.effectId(kwArgs.from);
    if (id === 'gem') {
      const template = this.template('useGem', item);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[ITEM]', this.effect(item))
        .replace('[MOVE]', kwArgs.move),
        args, kwArgs);
    }
    if (id === 'stealeat') {
      const template = this.template('removeItem', "Bug Bite");
      return this.out(line1 + template
        .replace('[SOURCE]', this.pokemon(kwArgs.of))
        .replace('[ITEM]', this.effect(item)),
        args, kwArgs);
    }
    if (kwArgs.from) {
      const template = this.template('removeItem', kwArgs.from);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[ITEM]', this.effect(item))
        .replace('[SOURCE]', this.pokemon(kwArgs.of)),
        args, kwArgs);
    }
    if (kwArgs.weaken) {
      const template = this.template('activateWeaken');
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[ITEM]', this.effect(item)),
        args, kwArgs);
    }
    let template = this.template('end', item, 'NODEFAULT');
    if (!template) template = this.template('activateItem').replace('[ITEM]', this.effect(item));
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[TARGET]', this.pokemon(kwArgs.of)),
      args, kwArgs);
  }

  '-status'(args: Args['-status'], kwArgs: KWArgs['-status']) {
    const [, pokemon, status] = args;
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    if (TextParser.effectId(kwArgs.from) === 'rest') {
      const template = this.template('startFromRest', status);
      return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
    }
    const template = this.template('start', status);
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  '-curestatus'(args: Args['-curestatus'], kwArgs: KWArgs['-curestatus']) {
    const [, pokemon, status] = args;
    if (TextParser.effectId(kwArgs.from) === 'naturalcure') {
      const template = this.template('activate', kwArgs.from);
      return this.out(template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
    }
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    if (kwArgs.from?.startsWith('item:')) {
      const template = this.template('endFromItem', status);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[ITEM]', this.effect(kwArgs.from)),
        args, kwArgs);
    }
    if (kwArgs.thaw) {
      const template = this.template('endFromMove', status);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[MOVE]', this.effect(kwArgs.from)),
        args, kwArgs);
    }
    let template = this.template('end', status, 'NODEFAULT');
    if (!template) template = this.template('end').replace('[EFFECT]', status);
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  '-cureteam'(args: Args['-cureteam'], kwArgs: KWArgs['-cureteam']) {
    return this.out(this.template('activate', kwArgs.from), args, kwArgs);
  }

  '-singleturn'(args: Args['-singleturn'], kwArgs: KWArgs['-singleturn']) {
    return this.single(args, kwArgs);
  }

  '-singlemove'(args: Args['-singlemove']) {
    return this.single(args, {});
  }

  '-sidestart'(args: Args['-sidestart']) {
    let [, side, effect] = args;
    let template = this.template('start', effect, 'NODEFAULT');
    if (!template) {
      template = this.template('startTeamEffect').replace('[EFFECT]', this.effect(effect));
    }
    return this.out(template
      .replace('[TEAM]', this.team(side))
      .replace('[PARTY]', this.party(side)),
      args, kwArgs);
  }

  '-sideend'(args: Args['-sideend'], kwArgs: KWArgs['-sideend']) {
    let [, side, effect] = args;
    let template = this.template('end', effect, 'NODEFAULT');
    if (!template) {
      template = this.template('endTeamEffect').replace('[EFFECT]', this.effect(effect));
    }
    return this.out(template
      .replace('[TEAM]', this.team(side))
      .replace('[PARTY]', this.party(side)),
      args, kwArgs);
  }

  '-weather'(args: Args['-weather'], kwArgs: KWArgs['-weather']) {
    const [, weather] = args;
    if (!weather || weather === 'none') {
      const template = this.template('end', kwArgs.from, 'NODEFAULT');
      if (!template) {
        return this.out(this.template('endFieldEffect')
          .replace('[EFFECT]', this.effect(weather)),
          args, kwArgs);
      }
      return this.out(template, args, kwArgs);
    }
    if (kwArgs.upkeep) {
      return this.out(this.template('upkeep', weather, 'NODEFAULT'), args, kwArgs);
    }
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of);
    let template = this.template('start', weather, 'NODEFAULT');
    if (!template) {
      template = this.template('startFieldEffect').replace('[EFFECT]', this.effect(weather));
    }
    return this.out(line1 + template, args, kwArgs);
  }

  '-fieldstart'(args: Args['-fieldstart']) {
    return this.fieldbegin(args, {});
  }

  '-fieldactivate'(args: Args['-fieldactivate']) {
    return this.fieldbegin(args, {});
  }

  '-fieldend'(args: Args['-fieldend'], kwArgs: KWArgs['-fieldend']) {
    let [, effect] = args;
    let template = this.template('end', effect, 'NODEFAULT');
    if (!template) {
      template = this.template('endFieldEffect').replace('[EFFECT]', this.effect(effect));
    }
    return this.out(template, args, kwArgs);
  }

  '-sethp'(args: Args['-sethp'], kwArgs: KWArgs['-sethp']) {
    return this.out(this.template('activate', kwArgs.from), args, kwArgs);
  }

  '-message'(args: Args['-message']) {
    let [, message] = args;
    return this.out(`${message}\n`, args);
  }

  '-hint'(args: Args['-hint']) {
    let [, message] = args;
    return this.out(`  (${message})\n`, args);
  }

  '-activate'(args: Args['-activate'], kwArgs: KWArgs['-activate']) {
    let [, pokemon, effect, target] = args;
    let id = TextParser.effectId(effect);
    if (id === 'celebrate') {
      return this.out(this.template('activate', 'celebrate')
        .replace('[TRAINER]', this.trainer(pokemon.slice(0, 2))),
        args, kwArgs);
    }
    const breaks = ['hyperspacefury', 'hyperspacehole', 'phantomforce', 'shadowforce', 'feint'];
    if (!target && breaks.includes(id)) {
      [pokemon, target] = [kwArgs.of, pokemon];
      if (!pokemon) pokemon = target;
    }
    if (!target) target = kwArgs.of || pokemon;

    let line1 = this.maybeAbility(effect, pokemon);

    if (id === 'lockon' || id === 'mindreader') {
      const template = this.template('start', effect);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(kwArgs.of))
        .replace('[SOURCE]', this.pokemon(pokemon)),
        args, kwArgs);
    }

    if (id === 'mummy') {
      line1 += this.ability(kwArgs.ability, target);
      line1 += this.ability('Mummy', target);
      const template = this.template('changeAbility', 'mummy');
      return this.out(line1 + template.replace('[TARGET]', this.pokemon(target)), args, kwArgs);
    }

    let templateId = 'activate';
    if (id === 'forewarn' && pokemon === target) {
      templateId = 'activateNoTarget';
    }
    let template = this.template(templateId, effect, 'NODEFAULT');
    if (!template) {
      if (line1) return this.out(line1, args, kwArgs); // Abilities don't have a default template
      template = this.template('activate');
      return this.out(line1 + template.replace('[EFFECT]', this.effect(effect)), args, kwArgs);
    }

    if (id === 'brickbreak') {
      template = template.replace('[TEAM]', this.team(target.slice(0, 2)));
    }
    if (kwArgs.ability) {
      line1 += this.ability(kwArgs.ability, pokemon);
    }
    if (kwArgs.ability2) {
      line1 += this.ability(kwArgs.ability2, target);
    }
    if (kwArgs.move || kwArgs.number || kwArgs.item) {
      template = template
        .replace('[MOVE]', kwArgs.move)
        .replace('[NUMBER]', kwArgs.number)
        .replace('[ITEM]', kwArgs.item);
    }
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[TARGET]', this.pokemon(target))
      .replace('[SOURCE]', this.pokemon(kwArgs.of)),
      args, kwArgs);
  }

  '-prepare'(args: Args['-prepare']) {
    const [, pokemon, effect, target] = args;
    const template = this.template('prepare', effect);
    return this.out(template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[TARGET]', this.pokemon(target)),
      args);
  }

  '-damage'(args: Args['-damage'], kwArgs: KWArgs['-damage']) {
    let [, pokemon, , percentage] = args;
    let template = this.template('damage', kwArgs.from, 'NODEFAULT');
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    const id = TextParser.effectId(kwArgs.from);
    if (template) {
      return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
    }

    if (!kwArgs.from) {
      template = this.template(percentage ? 'damagePercentage' : 'damage');
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[PERCENTAGE]', percentage),
        args, kwArgs);
    }
    if (kwArgs.from.startsWith('item:')) {
      template = this.template(kwArgs.of ? 'damageFromPokemon' : 'damageFromItem');
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[ITEM]', this.effect(kwArgs.from))
        .replace('[SOURCE]', this.pokemon(kwArgs.of)),
        args, kwArgs);
    }
    if (kwArgs.partiallytrapped || id === 'bind' || id === 'wrap') {
      template = this.template('damageFromPartialTrapping');
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[MOVE]', this.effect(kwArgs.from)),
        args, kwArgs);
    }

    template = this.template('damage');
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  '-heal'(args: Args['-heal'], kwArgs: KWArgs['-heal']) {
    let [, pokemon] = args;
    let template = this.template('heal', kwArgs.from, 'NODEFAULT');
    const line1 = this.maybeAbility(kwArgs.from, pokemon);
    if (template) {
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[SOURCE]', this.pokemon(kwArgs.of))
        .replace('[NICKNAME]', kwArgs.wisher),
        args, kwArgs);
    }

    if (kwArgs.from && !kwArgs.from.startsWith('ability:')) {
      template = this.template('healFromEffect');
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[EFFECT]', this.effect(kwArgs.from)),
        args, kwArgs);
    }

    template = this.template('heal');
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  '-boost'(args: Args['-boost'], kwArgs: KWArgs['-boost']) {
    return this.boost(args, kwArgs);
  }

  '-unboost'(args: Args['-unboost'], kwArgs: KWArgs['-unboost']) {
    return this.boost(args, kwArgs);
  }

  '-setboost'(args: Args['-setboost'], kwArgs: KWArgs['-setboost']) {
    const [, pokemon] = args;
    const effect = kwArgs.from;
    const line1 = this.maybeAbility(effect, kwArgs.of || pokemon);
    const template = this.template('boost', effect);
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  '-swapboost'(args: Args['-swapboost'], kwArgs: KWArgs['-swapboost']) {
    const [, pokemon, target] = args;
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    const id = TextParser.effectId(kwArgs.from);
    let templateId = 'swapBoost';
    if (id === 'guardswap') templateId = 'swapDefensiveBoost';
    if (id === 'powerswap') templateId = 'swapOffensiveBoost';
    const template = this.template(templateId, kwArgs.from);
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[TARGET]', this.pokemon(target)),
      args, kwArgs);
  }

  '-copyboost'(args: Args['-copyboost']) {
    const [, pokemon, target] = args;
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    const template = this.template('copyBoost', kwArgs.from);
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[TARGET]', this.pokemon(target)), args);
  }

  '-clearboost'(args: Args['-clearboost']) {
    return this.clearboost(args, {});
  }

  '-clearpositiveboost'(args: Args['-clearpositiveboost']) {
    return this.clearboost(args, {});
  }

  '-clearnegativeboost'(args: Args['-clearnegativeboost'], kwArgs: KWArgs['-clearnegativeboost']) {
    return this.clearboost(args, kwArgs);
  }

  '-invertboost'(args: Args['-invertboost'], kwArgs: KWArgs['-invertboost']) {
    const [, pokemon] = args;
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    const template = this.template('invertBoost', kwArgs.from);
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  '-clearallboost'(args: Args['-clearallboost']) {
    return this.out(this.template('clearAllBoost', kwArgs.from), args, kwArgs);
  }

  '-crit'(args: Args['-crit'], kwArgs: KWArgs['-crit']) {
    return this.effectiveness(args, kwArgs);
  }

  '-supereffective'(args: Args['-supereffective'], kwArgs: KWArgs['-supereffective']) {
    return this.effectiveness(args, kwArgs);
  }

  '-resisted'(args: Args['-resisted'], kwArgs: KWArgs['-resisted']) {
    return this.effectiveness(args, kwArgs);
  }

  '-block'(args: Args['-block'], kwArgs: KWArgs['-block']) {
    let [, pokemon, effect, move, attacker] = args;
    const line1 = this.maybeAbility(effect, kwArgs.of || pokemon);
    const template = this.template('block', effect);
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[SOURCE]', this.pokemon(attacker || kwArgs.of))
      .replace('[MOVE]', move),
      args, kwArgs);
  }

  '-fail'(args: Args['-fail'], kwArgs: KWArgs['-fail']) {
    let [, pokemon, effect, stat] = args;
    let id = TextParser.effectId(effect);
    let blocker = TextParser.effectId(kwArgs.from);
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    let templateId = 'block';
    if (['desolateland', 'primordialsea'].includes(blocker) &&
      !['sunnyday', 'raindance', 'sandstorm', 'hail'].includes(id)) {
      templateId = 'blockMove';
    } else if (blocker === 'uproar' && kwArgs.msg) {
      templateId = 'blockSelf';
    }
    let template = this.template(templateId, kwArgs.from);
    if (template) {
      return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
    }

    if (id === 'unboost') {
      template = this.template(stat ? 'failSingular' : 'fail', 'unboost');
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[STAT]', stat), args, kwArgs);
    }

    templateId = 'fail';
    if (['brn', 'frz', 'par', 'psn', 'slp', 'substitute'].includes(id)) {
      templateId = 'alreadyStarted';
    }
    if (kwArgs.heavy) templateId = 'failTooHeavy';
    if (kwArgs.weak) templateId = 'fail';
    if (kwArgs.forme) templateId = 'failWrongForme';
    template = this.template(templateId, id);
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  '-immune'(args: Args['-immune'], kwArgs: KWArgs['-immune']) {
    const [, pokemon] = args;
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    let template = this.template('block', kwArgs.from);
    if (!template) {
      const templateId = kwArgs.ohko ? 'immuneOHKO' : 'immune';
      template = this.template(pokemon ? templateId : 'immuneNoPokemon', kwArgs.from);
    }
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  '-miss'(args: Args['-miss']) {
    const [, source, pokemon] = args;
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    if (!pokemon) {
      const template = this.template('missNoPokemon');
      return this.out(line1 + template.replace('[SOURCE]', this.pokemon(source)), args, kwArgs);
    }
    const template = this.template('miss');
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  '-center'(args: Args['-center']) {
    return this.out(this.template('center'), args);
  }

  '-ohko'(args: Args['-ohko']) {
    return this.out(this.template('ohko'), args);
  }

  '-combine'(args: Args['-combine']) {
    return this.out(this.template('combine'), args);
  }

  '-notarget'(args: Args['-notarget']) {
    return this.out(this.template('noTarget'), args);
  }

  '-mega'(args: Args['-mega']) {
    return this.mega(args);
  }

  '-primal'(args: Args['-primal']) {
    return this.mega(args);
  }

  '-zpower'(args: Args['-zpower']) {
    const [, pokemon] = args;
    const template = this.template('zPower');
    return this.out(template.replace('[POKEMON]', this.pokemon(pokemon)), args);
  }

  '-burst'(args: Args['-burst']) {
    const [, pokemon] = args;
    const template = this.template('activate', "Ultranecrozium Z");
    return this.out(template.replace('[POKEMON]', this.pokemon(pokemon)), args);
  }

  '-zbroken'(args: Args['-zbroken']) {
    const [, pokemon] = args;
    const template = this.template('zBroken');
    return this.out(template.replace('[POKEMON]', this.pokemon(pokemon)), args);
  }

  '-hitcount'(args: Args['-hitcount']) {
    const [, , num] = args;
    if (num === '1') {
      return this.out(this.template('hitCountSingular'), args);
    }
    return this.out(this.template('hitCount').replace('[NUMBER]', num), args);
  }

  '-waiting'(args: Args['-waiting']) {
    const [, pokemon, target] = args;
    const template = this.template('activate', "Water Pledge");
    return this.out(template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[TARGET]', this.pokemon(target)),
      args);
  }

  '-anim'(args: Args['-anim']) {
    return this.out('', args);
  }

  private finish(args: Args['win' | 'tie']) {
    const [cmd, name] = args;
    if (cmd === 'tie' || !name) {
      return this.out(this.template('tieBattle')
        .replace('[TRAINER]', this.#p1)
        .replace('[TRAINER]', this.#p2),
        args);
    }
    return this.out(this.template('winBattle').replace('[TRAINER]', name), args);
  }

  private change(
    args: Args['detailschange' | '-formechange' | '-transform'],
    kwArgs: KWArgs['detailschange' | '-formechange' | '-transform']) {

    const [cmd, pokemon, arg2, arg3] = args;
    let newSpecies = '' as Protocol.Species;
    switch (cmd) {
      case 'detailschange': newSpecies = arg2.split(',')[0].trim() as Protocol.Species; break;
      case '-transform': newSpecies = arg3; break;
      case '-formechange': newSpecies = arg2; break;
    }
    let newSpeciesId = toID(newSpecies);
    let id = '';
    let templateName = 'transform';
    if (cmd !== '-transform') {
      switch (newSpeciesId) {
        case 'greninjaash': id = 'battlebond'; break;
        case 'mimikyubusted': id = 'disguise'; break;
        case 'zygardecomplete': id = 'powerconstruct'; break;
        case 'necrozmaultra': id = 'ultranecroziumz'; break;
        case 'darmanitanzen': id = 'zenmode'; break;
        case 'darmanitan': id = 'zenmode'; templateName = 'transformEnd'; break;
        case 'darmanitangalarzen': id = 'zenmode'; break;
        case 'darmanitangalar': id = 'zenmode'; templateName = 'transformEnd'; break;
        case 'aegislashblade': id = 'stancechange'; break;
        case 'aegislash': id = 'stancechange'; templateName = 'transformEnd'; break;
        case 'wishiwashischool': id = 'schooling'; break;
        case 'wishiwashi': id = 'schooling'; templateName = 'transformEnd'; break;
        case 'miniormeteor': id = 'shieldsdown'; break;
        case 'minior': id = 'shieldsdown'; templateName = 'transformEnd'; break;
        case 'eiscuenoice': id = 'iceface'; break;
        case 'eiscue': id = 'iceface'; templateName = 'transformEnd'; break;
      }
    } else if (newSpecies) {
      id = 'transform';
    }
    const template = this.template(templateName, id, kwArgs.msg ? '' : 'NODEFAULT');
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[SPECIES]', newSpecies),
      args, kwArgs);
  }

  private single(
    args: Args['-singleturn' | '-singlemove'],
    kwArgs: KWArgs['-singleturn' | '-singlemove']
  ) {
    const [, pokemon, effect] = args;
    const line1 = this.maybeAbility(effect, kwArgs.of || pokemon) ||
      this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    let id = TextParser.effectId(effect);
    if (id === 'instruct') {
      const template = this.template('activate', effect);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(kwArgs.of))
        .replace('[TARGET]', this.pokemon(pokemon)),
        args, kwArgs);
    }
    let template = this.template('start', effect, 'NODEFAULT');
    if (!template) template = this.template('start').replace('[EFFECT]', this.effect(effect));
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[SOURCE]', this.pokemon(kwArgs.of))
      .replace('[TEAM]', this.team(pokemon.slice(0, 2))),
      args, kwArgs);
  }

  private fieldbegin(
    args: Args['-fieldstart' | '-fieldactivate'],
    kwArgs: KWArgs['-fieldstart' | '-fieldactivate']
  ) {
    const [cmd, effect] = args;
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of);
    let templateId = cmd.slice(6);
    if (TextParser.effectId(effect) === 'perishsong') templateId = 'start';
    let template = this.template(templateId, effect, 'NODEFAULT');
    if (!template) {
      template = this.template('startFieldEffect').replace('[EFFECT]', this.effect(effect));
    }
    return this.out(line1 + template.replace('[POKEMON]', this.pokemon(kwArgs.of)), args, kwArgs);
  }

  private boost(
    args: Args['-boost' | '-unboost'],
    kwArgs: KWArgs['-boost' | '-unboost']
  ) {
    let [cmd, pokemon, stat, num] = args;
    if (stat === 'spa' && this.#gen === 1) stat = 'spc';
    const amount = parseInt(num, 10);
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    let templateId = cmd.slice(1);
    if (amount >= 3) templateId += '3';
    else if (amount >= 2) templateId += '2';
    else if (amount === 0) templateId += '0';
    if (amount && kwArgs.zeffect) {
      templateId += (kwArgs.multiple ? 'MultipleFromZEffect' : 'FromZEffect');
    } else if (amount && kwArgs.from?.startsWith('item:')) {
      const template = this.template(templateId + 'FromItem', kwArgs.from);
      return this.out(line1 + template
        .replace('[POKEMON]', this.pokemon(pokemon))
        .replace('[STAT]', this.stat(stat))
        .replace('[ITEM]', this.effect(kwArgs.from)),
        args, kwArgs);
    }
    const template = this.template(templateId, kwArgs.from);
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[STAT]', this.stat(stat)),
      args, kwArgs);
  }

  private clearboost(
    args: Args['-clearboost' | '-clearpositiveboost' | '-clearnegativeboost'],
    kwArgs: KWArgs['-clearboost' | '-clearpositiveboost' | '-clearnegativeboost']
  ) {
    const [, pokemon, source] = args;
    const line1 = this.maybeAbility(kwArgs.from, kwArgs.of || pokemon);
    let templateId = 'clearBoost';
    if (kwArgs.zeffect) templateId = 'clearBoostFromZEffect';
    const template = this.template(templateId, kwArgs.from);
    return this.out(line1 + template
      .replace('[POKEMON]', this.pokemon(pokemon))
      .replace('[SOURCE]', this.pokemon(source)),
      args, kwArgs);
  }

  private effectiveness(
    args: Args['-crit' | '-supereffective' | '-resisted'],
    kwArgs: KWArgs['-crit' | '-supereffective' | '-resisted']
  ) {
    const [cmd, pokemon] = args;
    let templateId = cmd.slice(1);
    if (templateId === 'supereffective') templateId = 'superEffective';
    if (kwArgs.spread) templateId += 'Spread';
    const template = this.template(templateId);
    return this.out(template.replace('[POKEMON]', this.pokemon(pokemon)), args, kwArgs);
  }

  private mega(args: Args['-mega' | '-primal']) {
    const [cmd, pokemon, species, item] = args;
    let id = '';
    let templateId = cmd.slice(1);
    if (species === 'Rayquaza') {
      id = 'dragonascent';
      templateId = 'megaNoItem';
    }
    if (!id && cmd === '-mega' && this.#gen < 7) templateId = 'megaGen6';
    if (!item && cmd === '-mega') templateId = 'megaNoItem';
    let template = this.template(templateId, id);
    const side = pokemon.slice(0, 2);
    const pokemonName = this.pokemon(pokemon);
    if (cmd === '-mega') {
      const template2 = this.template('transformMega');
      template += template2.replace('[POKEMON]', pokemonName).replace('[SPECIES]', species);
    }
    return this.out(template
      .replace('[POKEMON]', pokemonName)
      .replace('[ITEM]', item)
      .replace('[TRAINER]', this.trainer(side)),
      args);
  }
}