// アニメのキャラのデッキ（サンプルデッキの「アニメのキャラ」）。アニメで使っていたカードを中心に、今のカードで組めるようにしたもの。
// アニメのデッキに合わせて、基本は1枚ずつ（ハイランダー）。海馬の青眼の白龍のように、アニメで複数枚使っていたものだけ例外。
// カードは英語名で書く（アプリのカードの英語名と合わせて探す）。[名前, 枚数]
// t：デッキの名前／s：作品／m：メインデッキ／x：EXデッキ（儀式ペンデュラムなどメインのカードはメインに入る）
const CHAR_DECKS = [
  { t: '武藤遊戯（バトル・シティ）', s: '遊☆戯☆王 デュエルモンスターズ', m: [
    ['Dark Magician', 1], ['Dark Magician Girl', 1], ['Kuriboh', 1], ['Celtic Guardian', 1], ['Big Shield Gardna', 1], ['Gazelle the King of Mythical Beasts', 1],
    ['Alpha The Magnet Warrior', 1], ['Beta The Magnet Warrior', 1], ['Gamma The Magnet Warrior', 1], ['Valkyrion the Magna Warrior', 1], ['Buster Blader', 1],
    ['Breaker the Magical Warrior', 1], ['Skilled Dark Magician', 1], ['Magician\'s Valkyria', 1], ['Gaia The Fierce Knight', 1], ['Curse of Dragon', 1],
    ['Black Luster Soldier', 1], ['Black Luster Ritual', 1], ['Swords of Revealing Light', 1], ['Monster Reborn', 1], ['Dark Magic Attack', 1],
    ['Thousand Knives', 1], ['Magical Dimension', 1], ['Dark Magic Curtain', 1], ['Polymerization', 1], ['Multiply', 1], ['Card of Sanctity', 1],
    ['Mirror Force', 1], ['Magic Cylinder', 1], ['Spellbinding Circle', 1], ['Mystical Space Typhoon', 1], ['Slifer the Sky Dragon', 1], ['Magician of Black Chaos', 1],
    ['Black Magic Ritual', 1], ['Mystical Elf', 1], ['Queen\'s Knight', 1], ['King\'s Knight', 1], ['Jack\'s Knight', 1], ['Summoned Skull', 1], ['Feral Imp', 1]], x: [
    ['Dark Paladin', 1], ['Dark Flare Knight', 1], ['Gaia the Dragon Champion', 1], ['Dark Magician Girl the Dragon Knight', 1], ['Dark Cavalry', 1], ['Arcana Knight Joker', 1]] },
  { t: '海馬瀬人（バトル・シティ）', s: '遊☆戯☆王 デュエルモンスターズ', m: [
    ['Blue-Eyes White Dragon', 3], ['Lord of D.', 1], ['Kaibaman', 1], ['Vorse Raider', 1], ['X-Head Cannon', 1], ['Y-Dragon Head', 1], ['Z-Metal Tank', 1],
    ['Battle Ox', 1], ['La Jinn the Mystical Genie of the Lamp', 1], ['Saggi the Dark Clown', 1], ['Blade Knight', 1], ['Spear Dragon', 1], ['Kaiser Glider', 1],
    ['Obelisk the Tormentor', 1], ['The Flute of Summoning Dragon', 1], ['Polymerization', 1], ['Monster Reborn', 1], ['Cost Down', 1], ['Shrink', 1],
    ['Enemy Controller', 1], ['Burst Stream of Destruction', 1], ['Silent Doom', 1], ['Lightning Vortex', 1], ['Interdimensional Matter Transporter', 1],
    ['Ring of Destruction', 1], ['Crush Card Virus', 1], ['Negate Attack', 1], ['Mirror Force', 1], ['Shadow Spell', 1], ['Virus Cannon', 1], ['Magic Jammer', 1],
    ['Cyber Jar', 1], ['Hyozanryu', 1], ['Rare Metal Dragon', 1], ["Silver's Cry", 1], ['Pot of Greed', 1], ['Judge Man', 1], ['Rude Kaiser', 1]], x: [
    ['Blue-Eyes Ultimate Dragon', 1], ['XYZ-Dragon Cannon', 1], ['XY-Dragon Cannon', 1], ['XZ-Tank Cannon', 1], ['YZ-Tank Dragon', 1]] },
  { t: '城之内克也（バトル・シティ）', s: '遊☆戯☆王 デュエルモンスターズ', m: [
    ['Red-Eyes Black Dragon', 1], ['Baby Dragon', 1], ['Dice Jar', 1], ['Legendary Sword', 1], ['Copycat', 1], ['Graceful Charity', 1], ['Time Wizard', 1], ['Panther Warrior', 1],
    ['Rocket Warrior', 1], ['Gearfried the Iron Knight', 1], ['Little-Winguard', 1], ['Swordsman of Landstar', 1], ['Alligator\'s Sword', 1], ['Jinzo', 1],
    ['Gilford the Lightning', 1], ['Garoozis', 1], ['Flame Manipulator', 1], ['Masaki the Legendary Swordsman', 1], ['Red-Eyes Black Metal Dragon', 1],
    ['Insect Soldiers of the Sky', 1], ['Battle Warrior', 1], ['Graceful Dice', 1], ['Skull Dice', 1], ['Polymerization', 1], ['Scapegoat', 1], ['Shield & Sword', 1],
    ['Salamandra', 1], ['Fairy Box', 1], ['Monster Reborn', 1], ['Giant Trunade', 1], ['Kunai with Chain', 1], ['Magical Arm Shield', 1], ['Metalmorph', 1],
    ['Roll Out!', 1], ['Mirror Force', 1], ['Gamble', 1], ['Second Coin Toss', 1], ['Black Dragon\'s Chick', 1], ['Lava Battleguard', 1], ['Swamp Battleguard', 1]], x: [
    ['Thousand Dragon', 1], ['Black Skull Dragon', 1], ['Alligator\'s Sword Dragon', 1], ['Flame Swordsman', 1]] },
  { t: '遊城十代', s: '遊☆戯☆王デュエルモンスターズGX', m: [
    ['Elemental HERO Avian', 1], ['Elemental HERO Burstinatrix', 1], ['Elemental HERO Clayman', 1], ['Elemental HERO Sparkman', 1], ['Elemental HERO Bubbleman', 1],
    ['Elemental HERO Wildheart', 1], ['Elemental HERO Bladedge', 1], ['Elemental HERO Necroshade', 1], ['Elemental HERO Neos', 1], ['Winged Kuriboh', 1],
    ['Neo-Spacian Air Hummingbird', 1], ['Neo-Spacian Grand Mole', 1], ['Neo-Spacian Aqua Dolphin', 1], ['Neo-Spacian Flare Scarab', 1], ['Neo-Spacian Dark Panther', 1],
    ['Polymerization', 1], ['Miracle Fusion', 1], ['H - Heated Heart', 1], ['E - Emergency Call', 1], ['Fusion Recovery', 1], ['Monster Reborn', 1],
    ['R - Righteous Justice', 1], ['Skyscraper', 1], ['Transcendent Wings', 1], ['Hero Signal', 1], ['Hero Barrier', 1], ['Draining Shield', 1], ['Mirror Gate', 1],
    ['Contact Out', 1], ['Neo Space', 1], ['Card of Sanctity', 1], ['Neo-Spacian Glow Moss', 1], ['Spark Blaster', 1], ['O - Oversoul', 1], ['Pot of Greed', 1],
    ['Fake Hero', 1], ['Bubble Shuffle', 1], ['Bubble Illusion', 1], ['Hero Flash!!', 1], ['Winged Kuriboh LV10', 1]], x: [
    ['Elemental HERO Flame Wingman', 1], ['Elemental HERO Thunder Giant', 1], ['Elemental HERO Shining Flare Wingman', 1], ['Elemental HERO Tempest', 1],
    ['Elemental HERO Rampart Blaster', 1], ['Elemental HERO Wildedge', 1], ['Elemental HERO Steam Healer', 1], ['Elemental HERO Mudballman', 1],
    ['Elemental HERO Air Neos', 1], ['Elemental HERO Grand Neos', 1], ['Elemental HERO Aqua Neos', 1], ['Elemental HERO Flare Neos', 1], ['Elemental HERO Dark Neos', 1]] },
  { t: '不動遊星', s: '遊☆戯☆王5D\'s', m: [
    ['Junk Synchron', 1], ['Speed Warrior', 1], ['Quillbolt Hedgehog', 1], ['Nitro Synchron', 1], ['Turbo Synchron', 1], ['Debris Dragon', 1], ['Max Warrior', 1],
    ['Tuningware', 1], ['Shield Warrior', 1], ['Doppelwarrior', 1], ['Level Eater', 1], ['Stardust Xiaolong', 1], ['Drill Synchron', 1], ['Road Synchron', 1],
    ['Sonic Chick', 1], ['Unknown Synchron', 1], ['Junk Converter', 1], ['Monster Reborn', 1], ['Shooting Star Bow - Ceal', 1],
    ['One for One', 1], ['Card of Safe Return', 1], ['Synchro Boost', 1], ['Scrap-Iron Scarecrow', 1], ['Cosmic Blast', 1], ['Starlight Road', 1],
    ['Synchro Barrier', 1], ['Slip Summon', 1], ['Stardust Re-Spark', 1], ['Urgent Tuning', 1], ['Graceful Revival', 1],
    ['Quickdraw Synchron', 1], ['Synchron Explorer', 1], ['Junk Forward', 1], ['Mirror Force', 1],
    ['Fortress Warrior', 1], ['Hyper Synchron', 1], ['Spirit Force', 1], ['Defense Draw', 1], ['Synchro Spirits', 1], ['Stardust Mirage', 1]], x: [
    ['Stardust Dragon', 1], ['Junk Warrior', 1], ['Nitro Warrior', 1], ['Turbo Warrior', 1], ['Junk Gardna', 1], ['Junk Archer', 1], ['Shooting Star Dragon', 1],
    ['Junk Destroyer', 1], ['Majestic Star Dragon', 1], ['Formula Synchron', 1], ['Road Warrior', 1], ['Armory Arm', 1], ['Stardust Warrior', 1], ['Junk Berserker', 1]] },
  { t: 'ジャック・アトラス', s: '遊☆戯☆王5D\'s', m: [
    ['Dark Resonator', 1], ['Twin-Sword Marauder', 1], ['Big Piece Golem', 1], ['Medium Piece Golem', 1], ['Mad Archfiend', 1], ['Vice Dragon', 1], ['Dread Dragon', 1],
    ['Sinister Sprocket', 1], ['Strong Wind Dragon', 1], ['Red Sprinter', 1], ['Red Gardna', 1], ['Red Resonator', 1], ['Attack Gainer', 1], ['Chain Resonator', 1],
    ['Synkron Resonator', 1], ['Clock Resonator', 1], ['Force Resonator', 1], ['Resonator Engine', 1], ['Monster Reborn', 1], ['Crimson Fire', 1], ['Red Screen', 1],
    ['Fiend\'s Sanctuary', 1], ['Scarlet Security', 1], ['Red Reboot', 1], ['Battle Fader', 1], ['Mirror Force', 1], ['Dimensional Prison', 1], ['Trap Stun', 1],
    ['Power Supplier', 1], ['Red Warg', 1], ['Red Mirror', 1], ['Resonance Device', 1], ['Absolute Powerforce', 1], ['Savage Colosseum', 1],
    ['Barrier Resonator', 1], ['Flare Resonator', 1], ['Crimson Resonator', 1], ['Prideful Roar', 1], ['Burning Soul', 1], ['Majestic Dragon', 1]], x: [
    ['Red Dragon Archfiend', 1], ['Exploder Dragonwing', 1], ['Red Nova Dragon', 1], ['Red Wyvern', 1], ['Majestic Red Dragon', 1], ['Hot Red Dragon Archfiend', 1],
    ['Red Rising Dragon', 1], ['Scarlight Red Dragon Archfiend', 1], ['Archfiend Black Skull Dragon', 1]] },
  { t: '九十九遊馬', s: '遊☆戯☆王ZEXAL', m: [
    ['Gagaga Magician', 1], ['Gagaga Girl', 1], ['Gogogo Golem', 1], ['Dododo Warrior', 1], ['Zubaba Knight', 1], ['Gagaga Gardna', 1], ['Zubaba Buster', 1],
    ['Kagetokage', 1], ['Ganbara Knight', 1], ['Achacha Archer', 1], ['Gogogo Giant', 1], ['Dodododwarf Gogogoglove', 1], ['ZW - Unicorn Spear', 1],
    ['ZW - Lightning Blade', 1], ['ZW - Tornado Bringer', 1], ['Double or Nothing!', 1], ['Gagagabolt', 1], ['Xyz Unit', 1], ['Gagagatag', 1],
    ['Rank-Up-Magic Barian\'s Force', 1], ['Monster Reborn', 1], ['Onomatopaira', 1], ['Half Unbreak', 1], ['Xyz Reflect', 1], ['Utopia Buster', 1], ['Xyz Universe', 1],
    ['Kurivolt', 1], ['Gagaga Head', 1], ['Gogogo Ghost', 1], ['Dodododraw', 1], ['Zubababancho Gagagacoat', 1], ['Gagagawind', 1], ['Rank-Up-Magic - The Seventh One', 1],
    ['Goblindbergh', 1], ['Tasuke Knight', 1], ['Gagagarevenge', 1], ['Xyz Gift', 1], ['ZW - Ultimate Shield', 1], ['ZW - Phoenix Bow', 1], ['ZW - Sylphid Wing', 1]], x: [
    ['Number 39: Utopia', 1], ['Number C39: Utopia Ray', 1], ['Number C39: Utopia Ray V', 1], ['Number 39: Utopia Double', 1], ['Number 39: Utopia Beyond', 1],
    ['Number S39: Utopia the Lightning', 1], ['Number 34: Terror-Byte', 1], ['Number 106: Giant Hand', 1], ['Number 54: Lion Heart', 1], ['Number 99: Utopic Dragon', 1],
    ['Number 12: Crimson Shadow Armor Ninja', 1], ['ZW - Leo Arms', 1], ['Number F0: Utopic Future', 1], ['Number 17: Leviathan Dragon', 1]] },
  { t: '榊遊矢', s: '遊☆戯☆王ARC-V', m: [
    ['Odd-Eyes Pendulum Dragon', 1], ['Stargazer Magician', 1], ['Timegazer Magician', 1], ['Performapal Hip Hippo', 1], ['Performapal Kaleidoscorp', 1],
    ['Performapal Silver Claw', 1], ['Performapal Trump Witch', 1], ['Performapal Lizardraw', 1], ['Performapal Bot-Eyes Lizard', 1], ['Performapal Partnaga', 1],
    ['Performapal Sky Magician', 1], ['Performapal Monkeyboard', 1], ['Performapal Swincobra', 1], ['Odd-Eyes Phantom Dragon', 1], ['Performapal Odd-Eyes Light Phoenix', 1],
    ['Performapal Barracuda', 1], ['Performapal Turn Toad', 1], ['Performapal Fire Mufflerlion', 1], ['Smile World', 1], ['Pendulum Call', 1], ['Sky Iris', 1],
    ['Polymerization', 1], ['Odd-Eyes Fusion', 1], ['Pendulum Reborn', 1], ['Performapal Pinch Helper', 1], ['Monster Reborn', 1], ['Pendulum Hole', 1], ['Pendulum Shift', 1],
    ['Performapal Whim Witch', 1], ['Performapal Pendulum Sorcerer', 1], ['Performapal Gongato', 1], ['Odd-Eyes Mirage Dragon', 1], ['Performapal Guitartle', 1],
    ['Performapal Spikeagle', 1], ['Performapal Celestial Magician', 1], ['Odd-Eyes Pendulumgraph Dragon', 1],
    ['Performapal Gumgumouton', 1], ['Performapal Kuribohble', 1], ['Performapal Sword Fish', 1], ['Performapal Ballad', 1]], x: [
    ['Odd-Eyes Rebellion Dragon', 1], ['Odd-Eyes Vortex Dragon', 1], ['Odd-Eyes Meteorburst Dragon', 1], ['Odd-Eyes Venom Dragon', 1], ['Odd-Eyes Raging Dragon', 1],
    ['Odd-Eyes Absolute Dragon', 1], ['Odd-Eyes Wing Dragon', 1], ['Odd-Eyes Rebellion Xyz Dragon', 1], ['Supreme King Z-ARC', 1]] },
  { t: '藤木遊作（Playmaker）', s: '遊☆戯☆王VRAINS', m: [
    ['Cyberse Wizard', 1], ['Bitrooper', 1], ['Backup Secretary', 1], ['Cyberse Gadget', 1], ['Draconnet', 1], ['Dual Assembwurm', 1], ['Stack Reviver', 1],
    ['Defcon Bird', 1], ['Cynet Optimization', 1], ['Cyberse Synchron', 1], ['Leotron', 1], ['Dotscaper', 1],
    ['Cynet Recovery', 1], ['Cyberse Magician', 1], ['Clock Wyvern', 1], ['Cynet Conflict', 1],
    ['Linkslayer', 1], ['Cyberse White Hat', 1], ['ROM Cloudia', 1], ['RAM Clouder', 1], ['Balancer Lord', 1], ['Micro Coder', 1],
    ['Cynet Mining', 1], ['Cynet Universe', 1], ['Cynet Fusion', 1], ['Cynet Backdoor', 1], ['Monster Reborn', 1], ['Cynet Ritual', 1], ['Cyberse Beacon', 1],
    ['Recoded Alive', 1], ['Cynet Refresh', 1], ['Link Restart', 1],
    ['Bitron', 1], ['Widget Kid', 1], ['Code Generator', 1], ['Cynet Codec', 1], ['Cynet Storm', 1], ['Firewall Guardian', 1], ['Firewall Phantom', 1], ['Lockout Gardna', 1]], x: [
    ['Decode Talker', 1], ['Encode Talker', 1], ['Powercode Talker', 1], ['Transcode Talker', 1], ['Shootingcode Talker', 1], ['Firewall Dragon', 1],
    ['Firewall Dragon Darkfluid', 1], ['Link Spider', 1], ['Honeybot', 1], ['Decode Talker Extended', 1], ['Firewall eXceed Dragon', 1],
    ['Cyberse Quantum Dragon', 1], ['Accesscode Talker', 1], ['Cyberse Integrator', 1], ['Cyberse Accelerator', 1]] },
];
