// アニメのキャラのデッキ（サンプルデッキの「アニメのキャラ」）。アニメで使っていたカードを中心に、今のカードで組めるようにしたもの。
// アニメのデッキに合わせて、基本は1枚ずつ（ハイランダー）。アニメで複数枚あったことが確かめられたカードだけ2枚以上（海馬の青眼の白龍・召喚の笛、十代の融合、遊馬のガガガマジシャン・死者蘇生、Playmakerのビットロン）。
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
    ['Obelisk the Tormentor', 1], ['The Flute of Summoning Dragon', 2], ['Polymerization', 1], ['Monster Reborn', 1], ['Cost Down', 1], ['Shrink', 1],
    ['Enemy Controller', 1], ['Burst Stream of Destruction', 1], ['Silent Doom', 1], ['Lightning Vortex', 1], ['Interdimensional Matter Transporter', 1],
    ['Ring of Destruction', 1], ['Crush Card Virus', 1], ['Negate Attack', 1], ['Mirror Force', 1], ['Shadow Spell', 1], ['Virus Cannon', 1], ['Magic Jammer', 1],
    ['Cyber Jar', 1], ['Hyozanryu', 1], ['Rare Metal Dragon', 1], ["Silver's Cry", 1], ['Pot of Greed', 1], ['Judge Man', 1]], x: [
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
    ['Polymerization', 2], ['Miracle Fusion', 1], ['H - Heated Heart', 1], ['E - Emergency Call', 1], ['Fusion Recovery', 1], ['Monster Reborn', 1],
    ['R - Righteous Justice', 1], ['Skyscraper', 1], ['Transcendent Wings', 1], ['Hero Signal', 1], ['Hero Barrier', 1], ['Draining Shield', 1], ['Mirror Gate', 1],
    ['Contact Out', 1], ['Neo Space', 1], ['Card of Sanctity', 1], ['Neo-Spacian Glow Moss', 1], ['Spark Blaster', 1], ['O - Oversoul', 1], ['Pot of Greed', 1],
    ['Bubble Shuffle', 1], ['Bubble Illusion', 1], ['Hero Flash!!', 1], ['Winged Kuriboh LV10', 1]], x: [
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
    ['Gagaga Magician', 2], ['Gagaga Girl', 1], ['Gogogo Golem', 1], ['Dododo Warrior', 1], ['Zubaba Knight', 1], ['Gagaga Gardna', 1], ['Zubaba Buster', 1],
    ['Kagetokage', 1], ['Ganbara Knight', 1], ['Achacha Archer', 1], ['Gogogo Giant', 1], ['Dodododwarf Gogogoglove', 1], ['ZW - Unicorn Spear', 1],
    ['ZW - Lightning Blade', 1], ['ZW - Tornado Bringer', 1], ['Double or Nothing!', 1], ['Gagagabolt', 1], ['Xyz Unit', 1], ['Gagagatag', 1],
    ['Rank-Up-Magic Barian\'s Force', 1], ['Monster Reborn', 2], ['Onomatopaira', 1], ['Half Unbreak', 1], ['Xyz Reflect', 1], ['Utopia Buster', 1], ['Xyz Universe', 1],
    ['Kurivolt', 1], ['Gagaga Head', 1], ['Gogogo Ghost', 1], ['Dodododraw', 1], ['Zubababancho Gagagacoat', 1], ['Gagagawind', 1], ['Rank-Up-Magic - The Seventh One', 1],
    ['Goblindbergh', 1], ['Gagagarevenge', 1], ['ZW - Ultimate Shield', 1], ['ZW - Phoenix Bow', 1], ['ZW - Sylphid Wing', 1]], x: [
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
    ['Bitron', 2], ['Widget Kid', 1], ['Code Generator', 1], ['Cynet Codec', 1], ['Firewall Guardian', 1], ['Firewall Phantom', 1], ['Lockout Gardna', 1]], x: [
    ['Decode Talker', 1], ['Encode Talker', 1], ['Powercode Talker', 1], ['Transcode Talker', 1], ['Shootingcode Talker', 1], ['Firewall Dragon', 1],
    ['Firewall Dragon Darkfluid', 1], ['Link Spider', 1], ['Honeybot', 1], ['Decode Talker Extended', 1], ['Firewall eXceed Dragon', 1],
    ['Cyberse Quantum Dragon', 1], ['Accesscode Talker', 1], ['Cyberse Integrator', 1], ['Cyberse Accelerator', 1]] },
  { t: 'ペガサス・J・クロフォード', s: '遊☆戯☆王 デュエルモンスターズ', m: [
    ['Toon Alligator', 1], ['Manga Ryu-Ran', 1], ['Toon Mermaid', 1], ['Toon Summoned Skull', 1], ['Blue-Eyes Toon Dragon', 1], ['Toon Dark Magician Girl', 1],
    ['Toon Masked Sorcerer', 1], ['Toon Gemini Elf', 1], ['Toon Cannon Soldier', 1], ['Toon Goblin Attack Force', 1], ['Toon Cyber Dragon', 1], ['Toon Ancient Gear Golem', 1],
    ['Toon Barrel Dragon', 1], ['Toon Buster Blader', 1], ['Red-Eyes Toon Dragon', 1], ['Toon Dark Magician', 1], ['Toon Black Luster Soldier', 1], ['Toon Harpie Lady', 1],
    ['Relinquished', 1], ['Thousand-Eyes Idol', 1], ['Illusionist Faceless Mage', 1], ['Dark-Eyes Illusionist', 1],
    ['Toon World', 1], ['Toon Kingdom', 1], ['Toon Table of Contents', 1], ['Toon Rollback', 1], ['Shadow Toon', 1], ['Toon Mask', 1], ['Toon Page-Flip', 1],
    ['Toon Bookmark', 1], ['Black Illusion Ritual', 1], ['Change of Heart', 1], ['Monster Reborn', 1], ['Polymerization', 1],
    ['Toon Defense', 1], ['Toon Briefcase', 1], ['Toon Terror', 1], ['Dragon Capture Jar', 1], ['Mirror Force', 1], ['Magic Cylinder', 1]], x: [
    ['Thousand-Eyes Restrict', 1], ['Relinquished Anima', 1]] },
  { t: '孔雀舞', s: '遊☆戯☆王 デュエルモンスターズ', m: [
    ['Harpie Lady', 1], ['Harpie Lady Sisters', 1], ['Cyber Harpie Lady', 1], ['Harpie Girl', 1], ['Harpie Lady 1', 1], ['Harpie Lady 2', 1], ['Harpie Lady 3', 1],
    ['Harpie\'s Pet Dragon', 1], ['Harpie\'s Pet Baby Dragon', 1], ['Harpie Queen', 1], ['Harpie Channeler', 1], ['Harpie Dancer', 1], ['Harpie Harpist', 1],
    ['Harpie Perfumer', 1], ['Harpie Oracle', 1], ['Hysteric Fairy', 1],
    ['Elegant Egotist', 1], ['Rising Air Current', 1], ['Harpies\' Hunting Ground', 1], ['Triangle Ecstasy Spark', 1], ['Harpie\'s Feather Duster', 1],
    ['Harpie Lady Phoenix Formation', 1], ['Hysteric Sign', 1], ['Harpie\'s Feather Rest', 1], ['Cyber Shield', 1], ['Monster Reborn', 1], ['Polymerization', 1],
    ['Mystical Space Typhoon', 1], ['Pot of Greed', 1], ['Follow Wind', 1], ['Change of Heart', 1],
    ['Hysteric Party', 1], ['Harpie\'s Feather Storm', 1], ['Harpie Lady Elegance', 1], ['Mirror Wall', 1], ['Shadow Spell', 1], ['Mirror Force', 1],
    ['Sakuretsu Armor', 1], ['Dust Tornado', 1], ['Spellbinding Circle', 1]], x: [
    ['Harpie\'s Pet Phantasmal Dragon', 1], ['Cyber Slash Harpie Lady', 1], ['Harpie Conductor', 1]] },
  { t: '万丈目準', s: '遊☆戯☆王デュエルモンスターズGX', m: [
    ['Ojama Yellow', 1], ['Ojama Green', 1], ['Ojama Black', 1], ['Ojama Red', 1], ['Ojama Blue', 1], ['Armed Dragon LV3', 1], ['Armed Dragon LV5', 1],
    ['Armed Dragon LV7', 1], ['Armed Dragon LV10', 1], ['Light and Darkness Dragon', 1], ['X-Head Cannon', 1], ['Y-Dragon Head', 1], ['Z-Metal Tank', 1],
    ['V-Tiger Jet', 1], ['W-Wing Catapult', 1], ['Chthonian Soldier', 1], ['Infernal Flame Emperor', 1], ['Masked Dragon', 1],
    ['Ojama Delta Hurricane!!', 1], ['Ojamagic', 1], ['Ojama Country', 1], ['Level Up!', 1], ['Polymerization', 1], ['Monster Reborn', 1], ['Front Line Base', 1],
    ['Ojamatch', 1], ['Pot of Greed', 1], ['Ojamassimilation', 1], ['Unification', 1],
    ['Ojama Trio', 1], ['Chthonian Alliance', 1], ['Chthonian Blast', 1], ['Chthonian Polymer', 1], ['Ojama Duo', 1], ['Mirror Force', 1], ['Magic Cylinder', 1],
    ['Call of the Haunted', 1], ['Sakuretsu Armor', 1], ['Dimensional Prison', 1], ['Ojama Pajama', 1]], x: [
    ['Ojama King', 1], ['Ojama Knight', 1], ['XY-Dragon Cannon', 1], ['XZ-Tank Cannon', 1], ['YZ-Tank Dragon', 1], ['XYZ-Dragon Cannon', 1], ['VW-Tiger Catapult', 1],
    ['VWXYZ-Dragon Catapult Cannon', 1], ['Armed Dragon Catapult Cannon', 1], ['Ojama Emperor', 1]] },
  { t: '丸藤亮（カイザー）', s: '遊☆戯☆王デュエルモンスターズGX', m: [
    ['Cyber Dragon', 1], ['Proto-Cyber Dragon', 1], ['Cyber Dragon Zwei', 1], ['Cyber Dragon Drei', 1], ['Cyber Dragon Core', 1], ['Cyber Dragon Herz', 1],
    ['Cyber Dragon Vier', 1], ['Cyber Dragon Nachster', 1], ['Cyberdark Horn', 1], ['Cyberdark Edge', 1], ['Cyberdark Keel', 1], ['Cyberdark Claw', 1],
    ['Cyberdark Cannon', 1], ['Cyber Eltanin', 1], ['Cyber Valley', 1], ['Cyber Phoenix', 1], ['Cyber Ogre', 1],
    ['Power Bond', 1], ['Polymerization', 1], ['Overload Fusion', 1], ['Cyber Repair Plant', 1], ['Cyber Emergency', 1], ['Cybernetic Fusion Support', 1],
    ['Cyberload Fusion', 1], ['Cyberdark Impact!', 1], ['Future Fusion', 1], ['Different Dimension Capsule', 1], ['Photon Generator Unit', 1], ['Evolution Burst', 1],
    ['Limiter Removal', 1], ['Cybernetic Zone', 1], ['Monster Reborn', 1], ['Cybernetic Horizon', 1],
    ['Cybernetic Overflow', 1], ['Cyber Network', 1], ['Attack Reflector Unit', 1], ['Call of the Haunted', 1], ['Cybernetic Hidden Technology', 1],
    ['Fusion Recovery', 1], ['Three of a Kind', 1]], x: [
    ['Cyber Twin Dragon', 1], ['Cyber End Dragon', 1], ['Chimeratech Overdragon', 1], ['Chimeratech Fortress Dragon', 1], ['Cyberdark Dragon', 1],
    ['Cyber Dragon Nova', 1], ['Cyber Dragon Infinity', 1], ['Cyber Eternity Dragon', 1], ['Chimeratech Rampage Dragon', 1], ['Cyberdark End Dragon', 1],
    ['Cyber Dragon Sieger', 1], ['Chimeratech Megafleet Dragon', 1], ['Cyberdarkness Dragon', 1]] },
  { t: 'エド・フェニックス', s: '遊☆戯☆王デュエルモンスターズGX', m: [
    ['Destiny HERO - Diamond Dude', 1], ['Destiny HERO - Doom Lord', 1], ['Destiny HERO - Captain Tenacious', 1], ['Destiny HERO - Dreadmaster', 1],
    ['Destiny HERO - Blade Master', 1], ['Destiny HERO - Dasher', 1], ['Destiny HERO - Double Dude', 1], ['Destiny HERO - Defender', 1], ['Destiny HERO - Fear Monger', 1],
    ['Destiny HERO - Dogma', 1], ['Destiny HERO - Malicious', 1], ['Destiny HERO - Disk Commander', 1], ['Destiny HERO - Plasma', 1], ['Destiny HERO - Dunker', 1],
    ['Destiny HERO - Departed', 1], ['Destiny HERO - Dread Servant', 1], ['Destiny HERO - Drilldark', 1], ['Destiny HERO - Decider', 1], ['Destiny HERO - Dark Angel', 1],
    ['Destiny HERO - Celestial', 1], ['Destiny HERO - Drawhand', 1], ['Destiny HERO - Denier', 1],
    ['Destiny Draw', 1], ['Clock Tower Prison', 1], ['Over Destiny', 1], ['D - Spirit', 1], ['Polymerization', 1], ['Fusion Destiny', 1], ['D - Formation', 1],
    ['Destruction of Destiny', 1], ['Monster Reborn', 1], ['Magical Mallet', 1],
    ['Destiny Signal', 1], ['D - Shield', 1], ['D - Chain', 1], ['D - Counter', 1], ['Destiny Mirage', 1], ['D - Time', 1], ['D - Tactics', 1], ['D - Fortune', 1]], x: [
    ['Destiny End Dragoon', 1], ['Destiny HERO - Dystopia', 1], ['Destiny HERO - Dominance', 1], ['Destiny HERO - Destroyer Phoenix Enforcer', 1],
    ['Destiny HERO - Dusktopia', 1], ['Destiny HERO - Dangerous', 1]] },
  { t: 'クロウ・ホーガン', s: '遊☆戯☆王5D\'s', m: [
    ['Blackwing - Gale the Whirlwind', 1], ['Blackwing - Bora the Spear', 1], ['Blackwing - Sirocco the Dawn', 1], ['Blackwing - Blizzard the Far North', 1],
    ['Blackwing - Shura the Blue Flame', 1], ['Blackwing - Kalut the Moon Shadow', 1], ['Blackwing - Elphin the Raven', 1], ['Blackwing - Mistral the Silver Shield', 1],
    ['Blackwing - Vayu the Emblem of Honor', 1], ['Blackwing - Fane the Steel Chain', 1], ['Blackwing - Ghibli the Searing Wind', 1], ['Blackwing - Gust the Backblast', 1],
    ['Blackwing - Breeze the Zephyr', 1], ['Blackwing - Pinaki the Waxing Moon', 1], ['Blackwing - Jetstream the Blue Sky', 1], ['Blackwing - Zephyros the Elite', 1],
    ['Blackwing - Calima the Haze', 1], ['Blackwing - Jin the Rain Shadow', 1], ['Blackwing - Kris the Crack of Dawn', 1], ['Blackwing - Hillen the Tengu-wind', 1],
    ['Blackwing - Oroshi the Squall', 1], ['Blackwing - Steam the Cloak', 1],
    ['Black Whirlwind', 1], ['Cards of Consonance', 1], ['Monster Reborn', 1], ['Black-Winged Strafe', 1], ['Mystical Space Typhoon', 1], ['Pot of Greed', 1],
    ['Delta Crow - Anti Reverse', 1], ['Blackwing - Backlash', 1], ['Blackwing - Bombardment', 1], ['Blackwing - Boobytrap', 1], ['Black Feather Beacon', 1],
    ['Mirror Force', 1], ['Call of the Haunted', 1], ['Icarus Attack', 1], ['Sakuretsu Armor', 1], ['Blackwing - Twin Shadow', 1], ['Dust Tornado', 1], ['Blackwing - Simoon the Poison Wind', 1]], x: [
    ['Blackwing Armor Master', 1], ['Blackwing Armed Wing', 1], ['Blackwing - Silverwind the Ascendant', 1], ['Black-Winged Dragon', 1],
    ['Blackwing Tamer - Obsidian Hawk Joe', 1], ['Blackwing - Nothung the Starlight', 1], ['Blackwing Full Armor Master', 1], ['Black-Winged Assault Dragon', 1],
    ['Blackwing - Gram the Shining Star', 1], ['Blackwing - Boreastorm the Wicked Wind', 1]] },
  { t: '十六夜アキ', s: '遊☆戯☆王5D\'s', m: [
    ['Twilight Rose Knight', 1], ['Botanical Lion', 1], ['Dark Verger', 1], ['Lord Poison', 1], ['Evil Thorn', 1], ['Rose Tentacles', 1], ['Revival Rose', 1],
    ['Rose Papillon', 1], ['Blue Rose Dragon', 1], ['Rose Lover', 1], ['Regenerating Rose', 1], ['Witch of the Black Rose', 1], ['Rose Witch', 1], ['Copy Plant', 1],
    ['Gigaplant', 1], ['Hedge Guard', 1], ['Rose Fairy', 1], ['Rose, Warrior of Revenge', 1], ['Lonefire Blossom', 1], ['Dandylion', 1],
    ['Black Garden', 1], ['Magic Planter', 1], ['Fragrance Storm', 1], ['Mark of the Rose', 1], ['Monster Reborn', 1], ['Blooming of the Darkest Rose', 1],
    ['Black Rose Garden', 1], ['Miracle Fertilizer', 1], ['Pot of Greed', 1],
    ['Wall of Ivy', 1], ['Ivy Shackles', 1], ['Thorn of Malice', 1], ['Sinister Seeds', 1], ['Wall of Thorns', 1], ['Rose Bell of Revelation', 1], ['Thorns of Violet Poison', 1],
    ['Call of the Haunted', 1], ['Mirror Force', 1], ['Wicked Rebirth', 1], ['Phoenixian Cluster Amaryllis', 1]], x: [
    ['Black Rose Dragon', 1], ['Splendid Rose', 1], ['Black Rose Moonlight Dragon', 1], ['Queen of Thorns', 1], ['Rose Spectre of Dunn', 1],
    ['Crossrose Dragon', 1], ['Ruddy Rose Dragon', 1], ['Garden Rose Maiden', 1], ['Bramble Rose Dragon', 1]] },
  { t: '天城カイト', s: '遊☆戯☆王ZEXAL', m: [
    ['Galaxy-Eyes Photon Dragon', 1], ['Photon Crusher', 1], ['Photon Thrasher', 1], ['Photon Cerberus', 1], ['Photon Lizard', 1], ['Photon Satellite', 1],
    ['Photon Slasher', 1], ['Photon Pirate', 1], ['Photon Leo', 1], ['Photon Sabre Tiger', 1], ['Galaxy Knight', 1], ['Kuriphoton', 1], ['Galaxy Soldier', 1],
    ['Photon Orbital', 1], ['Photon Vanisher', 1], ['Photon Advancer', 1], ['Photon Emperor', 1], ['Galaxy-Eyes Cloudragon', 1], ['Galaxy Wizard', 1],
    ['Photon Veil', 1], ['Galaxy Expedition', 1], ['Photon Lead', 1], ['Photon Booster', 1], ['Photon Circle', 1], ['Photon Trident', 1], ['Galaxy Wave', 1],
    ['Photon Sanctuary', 1], ['Photon Hand', 1], ['Galaxy Zero', 1], ['Tachyon Transmigration', 1], ['Monster Reborn', 1],
    ['Galaxy Storm', 1], ['Photon Current', 1], ['Photon Stream of Destruction', 1], ['Galaxy Cyclone', 1], ['Tachyon Chaos Hole', 1], ['Mirror Force', 1],
    ['Call of the Haunted', 1], ['Photon Change', 1], ['Galaxy Queen\'s Light', 1]], x: [
    ['Number 62: Galaxy-Eyes Prime Photon Dragon', 1], ['Number C62: Neo Galaxy-Eyes Prime Photon Dragon', 1], ['Neo Galaxy-Eyes Photon Dragon', 1],
    ['Number 107: Galaxy-Eyes Tachyon Dragon', 1], ['Number C107: Neo Galaxy-Eyes Tachyon Dragon', 1], ['Photon Strike Bounzer', 1], ['Photon Papilloperative', 1],
    ['Starliege Photon Blast Dragon', 1], ['Galaxy-Eyes Full Armor Photon Dragon', 1], ['Twin Photon Lizard', 1], ['Number 90: Galaxy-Eyes Photon Lord', 1],
    ['Photon Alexandra Queen', 1], ['Number 95: Galaxy-Eyes Dark Matter Dragon', 1]] },
  { t: '神代凌牙（シャーク）', s: '遊☆戯☆王ZEXAL', m: [
    ['Big Jaws', 1], ['Skull Kraken', 1], ['Shark Stickers', 1], ['Hammer Shark', 1], ['Spear Shark', 1], ['Double Shark', 1], ['Sharkraken', 1], ['Panther Shark', 1],
    ['Eagle Shark', 1], ['Saber Shark', 1], ['Depth Shark', 1], ['Double Fin Shark', 1], ['Mermaid Shark', 1], ['Gazer Shark', 1], ['Hyper-Ancient Shark Megalodon', 1],
    ['Left-Hand Shark', 1], ['Right-Hand Shark', 1], ['Buzzsaw Shark', 1], ['Lantern Shark', 1], ['Abyss Shark', 1], ['Cutter Shark', 1], ['Drake Shark', 1],
    ['Aqua Jet', 1], ['Surfacing Big Jaws', 1], ['Rank-Up-Magic Barian\'s Force', 1], ['Monster Reborn', 1], ['Shark Cruiser', 1], ['Mystical Space Typhoon', 1],
    ['Xyz Encore', 1], ['Abyss-sphere', 1], ['Abyss-squall', 1], ['Abyss-strom', 1], ['Mirror Force', 1], ['Call of the Haunted', 1], ['Torrential Tribute', 1],
    ['Hydro Pressure Cannon', 1], ['Depth Amulet', 1], ['Fish Depth Charge', 1], ['Aqua Jet Surface', 1], ['Xyz Reborn', 1]], x: [
    ['Number 32: Shark Drake', 1], ['Number C32: Shark Drake Veiss', 1], ['Black Ray Lancer', 1], ['Full Armored Black Ray Lancer', 1], ['Number 73: Abyss Splash', 1],
    ['Number C73: Abyss Supra Splash', 1], ['Number 47: Nightmare Shark', 1], ['Bahamut Shark', 1], ['Number 37: Hope Woven Dragon Spider Shark', 1], ['Shark Fortress', 1],
    ['Submersible Carrier Aero Shark', 1], ['Number 71: Rebarian Shark', 1], ['Number 101: Silent Honor ARK', 1], ['Number C101: Silent Honor DARK', 1], ['Cat Shark', 1]] },
  { t: '赤馬零児', s: '遊☆戯☆王ARC-V', m: [
    ['D/D Savant Kepler', 1], ['D/D Savant Galilei', 1], ['D/D Cerberus', 1], ['D/D Lilith', 1], ['D/D Nighthowl', 1], ['D/D Proud Ogre', 1], ['D/D Swirl Slime', 1],
    ['D/D Necro Slime', 1], ['D/D Berfomet', 1], ['D/D Orthros', 1], ['D/D Lamia', 1], ['D/D Pandora', 1], ['D/D/D Rebel King Leonidas', 1],
    ['D/D/D Oblivion King Abyss Ragnarok', 1], ['D/D/D Dragon King Pendragon', 1], ['D/D Savant Newton', 1], ['D/D Savant Copernicus', 1], ['D/D Ghost', 1],
    ['D/D/D Supreme King Kaiser', 1], ['D/D/D Chaos King Apocalypse', 1], ['D/D Vice Typhon', 1], ['D/D/D Doom King Armageddon', 1], ['D/D Proud Chevalier', 1],
    ['D/D Savant Thomas', 1], ['D/D Savant Nikola', 1],
    ['Dark Contract with the Gate', 1], ['Dark Contract with the Swamp King', 1], ['Dark Contract with Errors', 1], ['Dark Contract with the Yamimakai', 1],
    ['Dark Contract with the Eternal Darkness', 1], ['D/D/D Human Resources', 1], ['Dark Contract with the Entities', 1], ['Dark Contract with the Witch', 1],
    ['D/D/D Contract Change', 1], ['Dark Contract with the Zero King', 1], ['Dark Contract with the Different Dimension', 1], ['Dark Contract with Patent License', 1],
    ['D/D/D Headhunt', 1], ['Polymerization', 1], ['Monster Reborn', 1]], x: [
    ['D/D/D Flame King Genghis', 1], ['D/D/D Gust King Alexander', 1], ['D/D/D Wave King Caesar', 1], ['D/D/D Oracle King d\'Arc', 1], ['D/D/D Marksman King Tell', 1],
    ['D/D/D Duo-Dawn King Kali Yuga', 1], ['D/D/D Wave Oblivion King Caesar Ragnarok', 1], ['D/D/D Dragonbane King Beowulf', 1], ['D/D/D Cursed King Siegfried', 1],
    ['D/D/D Flame High King Genghis', 1], ['D/D/D Gust High King Alexander', 1], ['D/D/D Wave High King Caesar', 1], ['D/D/D Stone King Darius', 1],
    ['D/D/D Super Doom King Purple Armageddon', 1], ['D/D/D Super Doom King Dark Armageddon', 1]] },
  { t: '鴻上了見（リボルバー）', s: '遊☆戯☆王VRAINS', m: [
    ['Anesthrokket Dragon', 1], ['Autorokket Dragon', 1], ['Magnarokket Dragon', 1], ['Shelrokket Dragon', 1], ['Metalrokket Dragon', 1], ['Silverrokket Dragon', 1],
    ['Exploderokket Dragon', 1], ['Hollowrokket Dragon', 1], ['Rokket Tracer', 1], ['Rokket Synchron', 1], ['Rokket Coder', 1], ['Rokket Caliber', 1],
    ['Rokket Loader', 1], ['Borreload Riot Dragon', 1], ['Absorouter Dragon', 1], ['Pot of Greed', 1], ['Sniffer Dragon', 1], ['Dimensional Allotrope Varis', 1],
    ['Dragonoid Generator', 1], ['Quick Launch', 1], ['Borrel Cooling', 1], ['Borrel Regenerator', 1], ['Borrel Supplier', 1], ['Storm Dragon\'s Return', 1],
    ['Borrel Reboot', 1], ['Monster Reborn', 1], ['Rokket Recharger', 1], ['Rokket Detonator', 1], ['Mystical Space Typhoon', 1], ['Dark Hole', 1],
    ['Mirror Force', 1], ['Call of the Haunted', 1], ['Torrential Tribute', 1], ['Solemn Judgment', 1], ['Dimensional Prison', 1], ['Magic Cylinder', 1],
    ['Compulsory Evacuation Device', 1], ['Sakuretsu Armor', 1], ['Bottomless Trap Hole', 1], ['Dust Tornado', 1]], x: [
    ['Topologic Bomber Dragon', 1], ['Borreload Dragon', 1], ['Topologic Trisbaena', 1], ['Borrelsword Dragon', 1], ['Miniborrel Dragon', 1], ['Topologic Gumblar Dragon', 1],
    ['Borrelguard Dragon', 1], ['Borreload Savage Dragon', 1], ['Booster Dragon', 1], ['Twin Triangle Dragon', 1], ['Borreload eXcharge Dragon', 1],
    ['Topologic Zeroboros', 1], ['Borreload Furious Dragon', 1], ['Quadborrel Dragon', 1], ['Striker Dragon', 1]] },
];
