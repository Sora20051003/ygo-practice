// アニメのキャラのデッキ（サンプルデッキの「アニメのキャラ」）。
// そのキャラがアニメで使ったカードだけで組む（Yugipedia のアニメのデッキの一覧で確かめたもの）。
// 実際に出ているカードが40枚に足りないキャラ（ペガサス・孔雀舞・十六夜アキ・赤馬零児）は、そのキャラがアニメで使ったアニメだけのカードで足している。
// 基本は1枚ずつ（ハイランダー）。アニメで複数枚あったことが確かめられたカードだけ2枚以上。
// カードは英語名で書く（アプリのカードの英語名と合わせて探す）。[名前, 枚数]
// t：デッキの名前／s：作品／m：メインデッキ／x：EXデッキ（儀式ペンデュラムなどメインのカードはメインに入る）
const CHAR_DECKS = [
  { t: "武藤遊戯", s: "遊☆戯☆王 デュエルモンスターズ", m: [
    ["Dark Magician", 1], ["Dark Magician Girl", 1], ["Kuriboh", 1], ["Celtic Guardian", 1], ["Big Shield Gardna", 1], ["Gazelle the King of Mythical Beasts", 1],
    ["Alpha The Magnet Warrior", 1], ["Beta The Magnet Warrior", 1], ["Gamma the Magnet Warrior", 1], ["Valkyrion the Magna Warrior", 1], ["Buster Blader", 1],
    ["Breaker the Magical Warrior", 1], ["Skilled Dark Magician", 1], ["Gaia The Fierce Knight", 1], ["Curse of Dragon", 1], ["Black Luster Soldier", 1],
    ["Black Luster Ritual", 1], ["Magician of Black Chaos", 1], ["Black Magic Ritual", 1], ["Mystical Elf", 1], ["Queen's Knight", 1], ["King's Knight", 1],
    ["Jack's Knight", 1], ["Summoned Skull", 1], ["Feral Imp", 1], ["Slifer the Sky Dragon", 1],
    ["Swords of Revealing Light", 1], ["Monster Reborn", 1], ["Magical Dimension", 1], ["Dark Magic Curtain", 1], ["Polymerization", 1], ["Multiply", 1],
    ["Card of Sanctity", 1], ["Thousand Knives", 1], ["Magic Formula", 1],
    ["Mirror Force", 1], ["Magic Cylinder", 1], ["Spellbinding Circle", 1], ["Mystical Space Typhoon", 1], ["Magical Hats", 1]], x: [
    ["Dark Paladin", 1], ["Dark Flare Knight", 1], ["Gaia the Dragon Champion", 1], ["Dark Magician Girl the Dragon Knight", 1], ["Black Skull Dragon", 1],
    ["Chimera the Flying Mythical Beast", 1]] },
  { t: "海馬瀬人", s: "遊☆戯☆王 デュエルモンスターズ", m: [
    ["Blue-Eyes White Dragon", 3], ["Lord of D.", 1], ["Vorse Raider", 1], ["X-Head Cannon", 1], ["Y-Dragon Head", 1], ["Z-Metal Tank", 1], ["Battle Ox", 1],
    ["La Jinn the Mystical Genie of the Lamp", 1], ["Saggi the Dark Clown", 1], ["Blade Knight", 1], ["Spear Dragon", 1], ["Kaiser Glider", 1],
    ["Obelisk the Tormentor", 1], ["Cyber Jar", 1], ["Hyozanryu", 1], ["Kaiser Sea Horse", 1], ["Paladin of White Dragon", 1], ["Swordstalker", 1],
    ["Thunder Dragon", 1], ["Different Dimension Dragon", 1],
    ["The Flute of Summoning Dragon", 2], ["Polymerization", 1], ["Monster Reborn", 1], ["Cost Down", 1], ["Shrink", 1], ["Enemy Controller", 1],
    ["Silent Doom", 1], ["Interdimensional Matter Transporter", 1], ["White Dragon Ritual", 1], ["De-Fusion", 1], ["Heavy Storm", 1], ["Graceful Charity", 1],
    ["Pot of Greed", 1],
    ["Ring of Destruction", 1], ["Crush Card Virus", 1], ["Virus Cannon", 1], ["Negate Attack", 1]], x: [
    ["Blue-Eyes Ultimate Dragon", 1], ["XY-Dragon Cannon", 1], ["XYZ-Dragon Cannon", 1], ["Twin-Headed Thunder Dragon", 1], ["Rabid Horseman", 1]] },
  { t: "城之内克也", s: "遊☆戯☆王 デュエルモンスターズ", m: [
    ["Red-Eyes Black Dragon", 1], ["Baby Dragon", 1], ["Time Wizard", 1], ["Jinzo", 1], ["Gearfried the Iron Knight", 1], ["Gearfried the Swordmaster", 1],
    ["Panther Warrior", 1], ["Rocket Warrior", 1], ["Axe Raider", 1], ["Little-Winguard", 1], ["Alligator's Sword", 1], ["Swordsman of Landstar", 1],
    ["Garoozis", 1], ["Battle Warrior", 1], ["Blue Flame Swordsman", 1], ["Hayabusa Knight", 1], ["The Legendary Fisherman", 1], ["Salamandra", 1],
    ["Lava Battleguard", 1], ["Swamp Battleguard", 1], ["Mad Sword Beast", 1], ["Red-Eyes Black Metal Dragon", 1], ["Graceful Dice", 1], ["Skull Dice", 1],
    ["Roulette Spider", 1], ["Paladin of Dark Dragon", 1],
    ["Scapegoat", 1], ["Monster Reborn", 1], ["Polymerization", 1], ["Shield & Sword", 1], ["Giant Trunade", 1], ["Release Restraint", 1],
    ["Dark Dragon Ritual", 1], ["Raigeki", 1],
    ["Metalmorph", 1], ["Magical Arm Shield", 1], ["Kunai with Chain", 1], ["Fairy Box", 1], ["Trap Hole", 1], ["Bottomless Trap Hole", 1]], x: [
    ["Flame Swordsman", 1], ["Thousand Dragon", 1], ["Black Skull Dragon", 1], ["Alligator's Sword Dragon", 1]] },
  { t: "ペガサス・J・クロフォード", s: "遊☆戯☆王 デュエルモンスターズ", m: [
    ["Toon Alligator", 1], ["Manga Ryu-Ran", 1], ["Toon Mermaid", 1], ["Toon Summoned Skull", 1], ["Blue-Eyes Toon Dragon", 1], ["Toon Dark Magician Girl", 1],
    ["Toon Masked Sorcerer", 1], ["Toon Gemini Elf", 1], ["Relinquished", 1], ["Thousand-Eyes Idol", 1], ["Illusionist Faceless Mage", 1],
    ["Dark-Eyes Illusionist", 1], ["Dark Rabbit", 1], ["Dragon Piper", 1], ["Flying Elephant", 1], ["Parrot Dragon", 1], ["Red Archery Girl", 1], ["Ryu-Ran", 1],
    ["Toon World", 1], ["Toon Kingdom", 1], ["Toon Table of Contents", 1], ["Toon Rollback", 1], ["Shadow Toon", 1], ["Toon Mask", 1], ["Comic Hand", 1],
    ["Black Illusion Ritual", 1], ["Polymerization", 1], ["Monster Reborn", 1], ["Card of Sanctity", 1], ["Doppelganger", 1], ["Shine Palace", 1],
    ["Eye of Illusion", 1], ["Negative Energy", 1],
    ["Toon Briefcase", 1], ["Dragon Capture Jar", 1], ["Gorgon's Eye", 1], ["Jigen Bakudan", 1], ["Killer Needle", 1], ["Tears of a Mermaid", 1], ["Trap Displacement", 1]], x: [
    ["Thousand-Eyes Restrict", 1], ["Bickuribox", 1]] },
  { t: "孔雀舞", s: "遊☆戯☆王 デュエルモンスターズ", m: [
    ["Harpie Lady", 3], ["Cyber Harpie Lady", 3], ["Harpie Lady Sisters", 1], ["Harpie's Pet Dragon", 1], ["Amazoness Archers", 1], ["Amazoness Chain Master", 1],
    ["Amazoness Fighter", 1], ["Amazoness Spellcaster", 1], ["Amazoness Swords Woman", 1], ["Dark Witch", 1], ["Dunames Dark Witch", 1],
    ["Elegant Egotist", 1], ["Cyber Shield", 2], ["Harpie's Feather Duster", 2], ["Harpie Lady Phoenix Formation", 1], ["Card of Sanctity", 1], ["De-Spell", 1],
    ["Graceful Charity", 1], ["Monster Reborn", 1], ["Spell Reproduction", 1], ["The Claw of Hermos", 1], ["The Seal of Orichalcos", 1], ["The Unfriendly Amazon", 1],
    ["Rose Whip", 1], ["Grave Arm", 1], ["Aero Nail", 1],
    ["Harpie's Feather Storm", 1], ["Mirror Wall", 1], ["Dramatic Rescue", 1], ["Fairy's Hand Mirror", 1], ["Gravity Bind", 1], ["Shadow of Eyes", 1],
    ["Trap Jammer", 1], ["Harpie Lady Sparrow Formation", 1]], x: [] },
  { t: "遊城十代", s: "遊☆戯☆王デュエルモンスターズGX", m: [
    ["Elemental HERO Avian", 1], ["Elemental HERO Burstinatrix", 1], ["Elemental HERO Clayman", 1], ["Elemental HERO Sparkman", 1], ["Elemental HERO Bubbleman", 2],
    ["Elemental HERO Wildheart", 1], ["Elemental HERO Bladedge", 1], ["Elemental HERO Necroshade", 1], ["Elemental HERO Neos", 1],
    ["Neo-Spacian Air Hummingbird", 1], ["Neo-Spacian Aqua Dolphin", 1], ["Neo-Spacian Dark Panther", 1], ["Neo-Spacian Flare Scarab", 1],
    ["Neo-Spacian Glow Moss", 1], ["Neo-Spacian Grand Mole", 1], ["Hero Kid", 1], ["Winged Kuriboh", 1], ["Card Trooper", 1], ["Necro Gardna", 1],
    ["Polymerization", 2], ["Miracle Fusion", 1], ["Fusion Recovery", 1], ["Neo Space", 1], ["E - Emergency Call", 2], ["Skyscraper", 1], ["H - Heated Heart", 1],
    ["R - Righteous Justice", 1], ["O - Oversoul", 1], ["Monster Reborn", 1], ["Pot of Greed", 1], ["Space Gift", 1],
    ["Hero Signal", 1], ["Mirror Gate", 1], ["Negate Attack", 1], ["Hero Barrier", 1], ["Draining Shield", 1], ["Call of the Haunted", 1]], x: [
    ["Elemental HERO Flame Wingman", 1], ["Elemental HERO Thunder Giant", 1], ["Elemental HERO Shining Flare Wingman", 1], ["Elemental HERO Rampart Blaster", 1],
    ["Elemental HERO Tempest", 1], ["Elemental HERO Wildedge", 1], ["Elemental HERO Mudballman", 1], ["Elemental HERO Steam Healer", 1], ["Elemental HERO Electrum", 1],
    ["Elemental HERO Air Neos", 1], ["Elemental HERO Aqua Neos", 1], ["Elemental HERO Flare Neos", 1], ["Elemental HERO Dark Neos", 1], ["Elemental HERO Glow Neos", 1],
    ["Elemental HERO Grand Neos", 1]] },
  { t: "万丈目準", s: "遊☆戯☆王デュエルモンスターズGX", m: [
    ["Chthonian Soldier", 3], ["Armed Dragon LV3", 3], ["Masked Dragon", 3], ["Armed Dragon LV5", 2], ["Armed Dragon LV7", 2], ["Armed Dragon LV10", 1],
    ["Ojama Yellow", 1], ["Ojama Green", 1], ["Ojama Black", 1], ["X-Head Cannon", 1], ["Y-Dragon Head", 1], ["Z-Metal Tank", 1], ["V-Tiger Jet", 1],
    ["W-Wing Catapult", 1],
    ["Level Up!", 1], ["Frontline Base", 1], ["Ojama Delta Hurricane!!", 1], ["Ojamagic", 1], ["Ojamuscle", 1], ["Polymerization", 1], ["Pot of Greed", 1],
    ["Graceful Charity", 1], ["Magical Mallet", 1], ["Armed Changer", 1], ["Reload", 1],
    ["Call of the Haunted", 1], ["Chthonian Alliance", 1], ["Chthonian Blast", 1], ["Chthonian Polymer", 1], ["Ojama Trio", 2], ["Ring of Destruction", 1]], x: [
    ["VW-Tiger Catapult", 1], ["XYZ-Dragon Cannon", 1], ["VWXYZ-Dragon Catapult Cannon", 1], ["Ojama King", 1]] },
  { t: "丸藤亮（カイザー）", s: "遊☆戯☆王デュエルモンスターズGX", m: [
    ["Cyber Dragon", 3], ["Proto-Cyber Dragon", 1], ["Cyber Barrier Dragon", 1], ["Cyber Laser Dragon", 1], ["Cyber Phoenix", 1], ["Cyber Kirin", 1],
    ["Cyber Ouroboros", 1], ["Cyber Valley", 1], ["Armored Cybern", 1], ["Cyberdark Edge", 1], ["Cyberdark Horn", 1], ["Cyberdark Keel", 1],
    ["Exploder Dragon", 1], ["Infernal Dragon", 1],
    ["Power Bond", 2], ["Polymerization", 2], ["Overload Fusion", 1], ["Future Fusion", 1], ["Cybernetic Fusion Support", 1], ["De-Fusion", 2],
    ["Photon Generator Unit", 1], ["Limiter Removal", 1], ["Different Dimension Capsule", 1], ["Dimension Explosion", 1], ["Monster Reborn", 1], ["Pot of Greed", 1],
    ["Cybernetic Zone", 1], ["Instant Fusion", 1], ["Mystical Space Typhoon", 1],
    ["Attack Reflector Unit", 1], ["Damage Polarizer", 1], ["Call of the Haunted", 1], ["Cybernetic Hidden Technology", 1], ["Fusion Guard", 1], ["Power Wall", 1]], x: [
    ["Cyber Twin Dragon", 1], ["Cyber End Dragon", 2], ["Chimeratech Overdragon", 2], ["Chimeratech Fortress Dragon", 1], ["Cyberdark Dragon", 1],
    ["Five-Headed Dragon", 1], ["Twin-Headed Thunder Dragon", 1]] },
  { t: "エド・フェニックス", s: "遊☆戯☆王デュエルモンスターズGX", m: [
    ["Destiny HERO - Plasma", 1], ["Destiny HERO - Dogma", 1], ["Destiny HERO - Diamond Dude", 1], ["Destiny HERO - Doom Lord", 1], ["Destiny HERO - Dreadmaster", 1],
    ["Destiny HERO - Malicious", 2], ["Destiny HERO - Captain Tenacious", 1], ["Destiny HERO - Blade Master", 1], ["Destiny HERO - Celestial", 1],
    ["Destiny HERO - Dark Angel", 1], ["Destiny HERO - Dasher", 1], ["Destiny HERO - Defender", 1], ["Destiny HERO - Departed", 1],
    ["Destiny HERO - Disk Commander", 1], ["Destiny HERO - Double Dude", 1], ["Destiny HERO - Dread Servant", 1], ["Destiny HERO - Dunker", 1],
    ["Destiny HERO - Fear Monger", 1], ["D Cubed", 3],
    ["Polymerization", 2], ["Clock Tower Prison", 1], ["D - Formation", 1], ["D - Spirit", 1], ["Dark City", 1], ["Destiny Draw", 1], ["Over Destiny", 1],
    ["D - Chain", 1], ["D - Counter", 1], ["D - Fortune", 1], ["D - Shield", 1], ["D - Time", 1], ["Destiny Mirage", 1], ["Destiny Signal", 1],
    ["Destruction of Destiny", 1], ["Eternal Dread", 2]], x: [
    ["Destiny End Dragoon", 1], ["Elemental HERO Phoenix Enforcer", 1], ["Elemental HERO Shining Phoenix Enforcer", 1]] },
  { t: "不動遊星", s: "遊☆戯☆王5D's", m: [
    ["Junk Synchron", 1], ["Speed Warrior", 1], ["Sonic Chick", 1], ["Quillbolt Hedgehog", 1], ["Nitro Synchron", 1], ["Turbo Synchron", 1], ["Hyper Synchron", 1],
    ["Road Synchron", 1], ["Quickdraw Synchron", 1], ["Debris Dragon", 1], ["Drill Synchron", 1], ["Majestic Dragon", 1], ["Shield Warrior", 1], ["Turret Warrior", 1],
    ["Level Eater", 1], ["Max Warrior", 1], ["Shield Wing", 1], ["Turbo Booster", 1], ["Tuningware", 1], ["Fortress Warrior", 1], ["Zero Gardna", 1],
    ["Healing Wave Generator", 1], ["Stardust Xiaolong", 1], ["Ghost Gardna", 1],
    ["Cards of Consonance", 1], ["Tuning", 1], ["Double Summon", 1], ["Silver Wing", 1], ["One for One", 1], ["Junk Barrage", 1], ["Fighting Spirit", 1],
    ["Scrap-Iron Scarecrow", 1], ["Urgent Tuning", 1], ["Graceful Revival", 1], ["Starlight Road", 1], ["Stardust Flash", 1], ["Shooting Star", 1],
    ["Limiter Overload", 1], ["Synchro Strike", 1], ["Spirit Force", 1]], x: [
    ["Stardust Dragon", 1], ["Junk Warrior", 1], ["Nitro Warrior", 1], ["Turbo Warrior", 1], ["Road Warrior", 1], ["Armory Arm", 1], ["Junk Archer", 1],
    ["Junk Berserker", 1], ["Junk Destroyer", 1], ["Drill Warrior", 1], ["Formula Synchron", 1], ["Majestic Star Dragon", 1], ["Shooting Star Dragon", 1],
    ["Shooting Quasar Dragon", 1], ["Cosmic Blazar Dragon", 1]] },
  { t: "ジャック・アトラス", s: "遊☆戯☆王5D's", m: [
    ["Big Piece Golem", 1], ["Medium Piece Golem", 1], ["Small Piece Golem", 1], ["Mad Archfiend", 1], ["Twin-Shield Defender", 1], ["Twin-Sword Marauder", 1],
    ["Vice Dragon", 1], ["Strong Wind Dragon", 1], ["Power Giant", 1], ["Power Invader", 1], ["Battle Fader", 1], ["Dark Resonator", 1], ["Chain Resonator", 1],
    ["Clock Resonator", 1], ["Creation Resonator", 1], ["Flare Resonator", 1], ["Force Resonator", 1], ["Mirror Resonator", 1], ["Barrier Resonator", 1],
    ["Synkron Resonator", 1], ["Red Nova", 1], ["Dread Dragon", 1], ["Majestic Dragon", 1], ["Trap Eater", 1], ["Dark Tinker", 1], ["Archfiend Interceptor", 1],
    ["Resonator Call", 1], ["Cost Down", 1], ["Double Summon", 1], ["Scarlet Security", 1], ["Megamorph", 1], ["Red Dragon Vase", 1], ["Mind Trust", 1],
    ["Red Screen", 1], ["Prideful Roar", 1], ["Fiendish Chain", 1], ["Crimson Fire", 1], ["Lineage of Destruction", 1], ["Revival Gift", 1], ["Urgent Tuning", 1]], x: [
    ["Red Dragon Archfiend", 1], ["Exploder Dragonwing", 1], ["Chaos King Archfiend", 1], ["Red Nova Dragon", 1], ["Majestic Red Dragon", 1], ["Crimson Blader", 1]] },
  { t: "クロウ・ホーガン", s: "遊☆戯☆王5D's", m: [
    ["Blackwing - Abrolhos the Megaquake", 1], ["Blackwing - Aurora the Northern Lights", 1], ["Blackwing - Bora the Spear", 2], ["Blackwing - Boreas the Sharp", 1],
    ["Blackwing - Brisote the Tailwind", 1], ["Blackwing - Calima the Haze", 1], ["Blackwing - Elphin the Raven", 1], ["Blackwing - Etesian of Two Swords", 1],
    ["Blackwing - Fane the Steel Chain", 1], ["Blackwing - Ghibli the Searing Wind", 1], ["Blackwing - Jetstream the Blue Sky", 1],
    ["Blackwing - Kalut the Moon Shadow", 1], ["Blackwing - Shura the Blue Flame", 1], ["Blackwing - Sirocco the Dawn", 1], ["Blackwing - Zephyros the Elite", 1],
    ["Blackwing - Blizzard the Far North", 1], ["Blackwing - Gale the Whirlwind", 1], ["Blackwing - Hillen the Tengu-wind", 1], ["Blackwing - Hurricane the Tornado", 1],
    ["Blackwing - Kochi the Daybreak", 1], ["Blackwing - Kogarashi the Wanderer", 1], ["Blackwing - Mistral the Silver Shield", 1], ["Blackwing - Oroshi the Squall", 1],
    ["Blackwing - Steam the Cloak", 1], ["Blackwing - Vayu the Emblem of Honor", 1],
    ["Black-Winged Strafe", 1], ["Cards for Black Feathers", 1], ["De-Synchro", 1], ["Reload", 1],
    ["Black Feather Beacon", 1], ["Black Return", 1], ["Black Sonic", 1], ["Black Thunder", 1], ["Black Wing Revenge", 1], ["Blackback", 1], ["Blackboost", 1],
    ["Blackwing - Backlash", 1], ["Blackwing - Boobytrap", 1], ["Delta Crow - Anti Reverse", 1]], x: [
    ["Black-Winged Dragon", 1], ["Blackwing - Silverwind the Ascendant", 1], ["Blackwing Armed Wing", 1], ["Blackwing Armor Master", 1]] },
  { t: "十六夜アキ", s: "遊☆戯☆王5D's", m: [
    ["Blue Rose Dragon", 1], ["Dark Verger", 1], ["Evil Thorn", 3], ["Hedge Guard", 2], ["Lord Poison", 1], ["Phoenixian Cluster Amaryllis", 1], ["Phoenixian Seed", 1],
    ["Revival Rose", 1], ["Rose Fairy", 1], ["Rose Tentacles", 1], ["Violet Witch", 1], ["Wall of Ivy", 1], ["Gigaplant", 1], ["Copy Plant", 1], ["Glow-Up Bulb", 1],
    ["Twilight Rose Knight", 1], ["Witch of the Black Rose", 1],
    ["Black Garden", 1], ["Fragrance Storm", 1], ["Ivy Shackles", 1], ["Magic Planter", 1], ["Mark of the Rose", 1], ["Seed of Deception", 1], ["Thorn of Malice", 1],
    ["Vengeful Servant", 1], ["Wonder Clover", 1], ["Rose Flame", 1],
    ["Blossom Bombardment", 1], ["Doppelganger", 1], ["Half Counter", 1], ["Nature's Reflection", 1], ["Overdoom Line", 1], ["Star Siphon", 1], ["Urgent Tuning", 1],
    ["Wicked Rebirth", 1], ["Cursed Ivy", 1], ["Closed Plant Gate", 1]], x: [
    ["Black Rose Dragon", 1], ["Splendid Rose", 1]] },
  { t: "九十九遊馬", s: "遊☆戯☆王ZEXAL", m: [
    ["Gagaga Magician", 2], ["Gagaga Girl", 1], ["Gagaga Caesar", 1], ["Gagaga Clerk", 1], ["Gagaga Gardna", 1], ["Gagaga Mancer", 1], ["Zubaba Knight", 1],
    ["Zubaba Buster", 1], ["Gogogo Golem", 1], ["Gogogo Giant", 1], ["Gogogo Ghost", 1], ["Dododo Warrior", 1], ["Dododo Witch", 1], ["Dododo Bot", 1],
    ["Ganbara Knight", 2], ["Toy Knight", 2], ["Kurivolt", 1], ["Rainbow Kuriboh", 1], ["Goblindbergh", 1], ["Tasuke Knight", 1],
    ["ZW - Unicorn Spear", 1], ["ZW - Phoenix Bow", 1], ["ZW - Lightning Blade", 1], ["ZW - Tornado Bringer", 1], ["ZW - Sylphid Wing", 1],
    ["Monster Reborn", 2], ["Wonder Wand", 2], ["Gagagabolt", 1], ["Gagagawind", 1], ["Rank-Up-Magic Numeron Force", 1], ["Double or Nothing!", 1],
    ["Half Unbreak", 1], ["Xyz Reborn", 1], ["Mirror Force", 1], ["Gagagaguard", 1]], x: [
    ["Number 39: Utopia", 1], ["Number C39: Utopia Ray", 1], ["Number C39: Utopia Ray V", 1], ["Number C39: Utopia Ray Victory", 1], ["Number 39: Utopia Roots", 1],
    ["Number 39: Utopia Beyond", 1], ["Number F0: Utopic Future", 1], ["ZW - Leo Arms", 1], ["Number 34: Terror-Byte", 1], ["Number 17: Leviathan Dragon", 1],
    ["Number 54: Lion Heart", 1], ["Gagaga Cowboy", 1], ["Gagaga Samurai", 1], ["Heroic Champion - Excalibur", 1], ["Number 61: Volcasaurus", 1]] },
  { t: "天城カイト", s: "遊☆戯☆王ZEXAL", m: [
    ["Galaxy-Eyes Photon Dragon", 1], ["Daybreaker", 3], ["Galaxy Knight", 2], ["Photon Lizard", 2], ["Galaxy Mirror Sage", 1], ["Galaxy Tyranno", 1],
    ["Galaxy Wizard", 1], ["Kuriphoton", 1], ["Lightserpent", 1], ["Overlay Sentinel", 1], ["Photon Caesar", 1], ["Photon Cerberus", 1], ["Photon Chargeman", 1],
    ["Photon Circle", 1], ["Photon Crusher", 1], ["Photon Delta Wing", 1], ["Photon Leo", 1], ["Photon Pirate", 1], ["Photon Satellite", 1], ["Photon Slasher", 1],
    ["Photon Thrasher", 1], ["Paladin of Photon Dragon", 1],
    ["Accellight", 1], ["Book of Moon", 1], ["Galaxy Expedition", 1], ["Galaxy Zero", 1], ["Luminous Dragon Ritual", 1], ["Monster Reborn", 1], ["Overlay Regen", 1],
    ["Photon Lead", 1], ["Photon Veil", 1], ["Polymerization", 1], ["Xyz Double Back", 1],
    ["Galaxy Storm", 1], ["Double Dragon Descent", 1], ["Lumenize", 1]], x: [
    ["Number 62: Galaxy-Eyes Prime Photon Dragon", 1], ["Neo Galaxy-Eyes Photon Dragon", 1], ["Number 2: Ninja Shadow Mosquito", 1], ["Number 9: Dyson Sphere", 1],
    ["Number 10: Illumiknight", 1], ["Number 20: Giga-Brilliant", 1], ["Number 30: Acid Golem of Destruction", 1], ["Number 46: Dragluon", 1],
    ["Starliege Lord Galaxion", 1], ["Starliege Paladynamo", 1], ["Twin Photon Lizard", 1]] },
  { t: "神代凌牙（シャーク）", s: "遊☆戯☆王ZEXAL", m: [
    ["Big Jaws", 1], ["Skull Kraken", 1], ["Shark Stickers", 1], ["Hammer Shark", 1], ["Spear Shark", 1], ["Double Shark", 1], ["Sharkraken", 1], ["Panther Shark", 1],
    ["Eagle Shark", 1], ["Saber Shark", 1], ["Depth Shark", 1], ["Double Fin Shark", 1], ["Mermaid Shark", 1], ["Gazer Shark", 2], ["Hyper-Ancient Shark Megalodon", 2],
    ["Cutter Shark", 1], ["Dream Shark", 1], ["Jawsman", 1], ["Silent Angler", 2], ["Xyz Remora", 1], ["Shocktopus", 1], ["Big Whale", 1], ["Needle Sunfish", 1],
    ["Starfish", 3],
    ["Aqua Jet", 1], ["Monster Reborn", 1], ["Mystical Space Typhoon", 1], ["Rank-Up-Magic - The Seventh One", 1], ["Rank-Up-Magic Quick Chaos", 1], ["Surface", 1],
    ["Salvage", 1],
    ["Xyz Dimension Splash", 1], ["Torrential Reborn", 1], ["Splash Capture", 1], ["Icy Crevasse", 1]], x: [
    ["Number 32: Shark Drake", 1], ["Number C32: Shark Drake Veiss", 1], ["Number 73: Abyss Splash", 1], ["Number C73: Abyss Supra Splash", 1],
    ["Number 101: Silent Honor ARK", 1], ["Number C101: Silent Honor DARK", 1], ["Black Ray Lancer", 1], ["Shark Fortress", 1], ["Shark Caesar", 1],
    ["Submersible Carrier Aero Shark", 1], ["Number 17: Leviathan Dragon", 1], ["Number 94: Crystalzero", 1], ["Number C102: Archfiend Seraph", 1],
    ["Number C103: Ragnafinity", 1], ["Number C104: Umbral Horror Masquerade", 1]] },
  { t: "榊遊矢", s: "遊☆戯☆王ARC-V", m: [
    ["Odd-Eyes Pendulum Dragon", 1], ["Stargazer Magician", 1], ["Timegazer Magician", 1], ["Xiangke Magician", 1], ["Xiangsheng Magician", 1],
    ["Timebreaker Magician", 1], ["Dragoncaller Magician", 1], ["Acrobatic Magician", 1], ["Tuning Magician", 1], ["Odd-Eyes Lancer Dragon", 1],
    ["Odd-Eyes Saber Dragon", 1], ["Performapal Hip Hippo", 1], ["Performapal Whip Snake", 1], ["Performapal Silver Claw", 1], ["Performapal Trampolynx", 1],
    ["Performapal Sword Fish", 1], ["Performapal Kaleidoscorp", 1], ["Performapal Fire Mufflerlion", 1], ["Performapal Monkeyboard", 1],
    ["Performapal Odd-Eyes Unicorn", 1], ["Performapal Odd-Eyes Light Phoenix", 1], ["Performapal Odd-Eyes Seer", 1], ["Performapal Odd-Eyes Synchron", 1],
    ["Performapal Pendulum Sorcerer", 1], ["Performapal Laugh Maker", 1], ["Performapal Lizardraw", 1], ["Performapal Bit Bite Turtle", 1],
    ["Performapal Five-Rainbow Magician", 1], ["Performapal Changeraffe", 1], ["Performapal Spikeagle", 1],
    ["Smile World", 1], ["Pendulum Storm", 1], ["Monster Reborn", 1], ["Polymerization", 1], ["Hippo Carnival", 1], ["Magical Star Illusion", 1],
    ["Performapal Call", 1], ["Performapal Pinch Helper", 1], ["Last Minute Cancel", 1], ["Wall of Disruption", 1]], x: [
    ["Beast-Eyes Pendulum Dragon", 1], ["Rune-Eyes Pendulum Dragon", 1], ["Brave-Eyes Pendulum Dragon", 1], ["Odd-Eyes Venom Dragon", 1],
    ["Starving Venom Fusion Dragon", 1], ["Performapal Gatlinghoul", 1], ["Clear Wing Synchro Dragon", 1], ["Odd-Eyes Wing Dragon", 1],
    ["Enlightenment Paladin", 1], ["Nirvana High Paladin", 1], ["Dark Rebellion Xyz Dragon", 1], ["Dark Requiem Xyz Dragon", 1], ["Odd-Eyes Rebellion Dragon", 1],
    ["Odd-Eyes Raging Dragon", 1]] },
  { t: "赤馬零児", s: "遊☆戯☆王ARC-V", m: [
    ["D/D/D Doom King Armageddon", 3], ["D/D Berfomet", 2], ["D/D Savant Nikola", 2], ["D/D Lilith", 1], ["D/D Necro Slime", 1], ["D/D Pandora", 1],
    ["D/D Swirl Slime", 1], ["D/D Vice Typhon", 1], ["D/D Ghost", 1], ["D/D Lamia", 1], ["D/D Nighthowl", 1], ["D/D Cerberus", 1], ["D/D Proud Chevalier", 1],
    ["D/D Savant Copernicus", 1], ["D/D Savant Galilei", 1], ["D/D Savant Kepler", 1], ["D/D Savant Newton", 1], ["D/D Savant Thomas", 1],
    ["D/D/D Chaos King Apocalypse", 1], ["D/D/D Oblivion King Abyss Ragnarok", 1], ["D/D Savant Dirac", 1], ["D/D Savant Schrödinger", 1], ["D/D Brownie", 1],
    ["Dark Contract with the Gate", 2], ["Dark Contract with the Swamp King", 1], ["Forbidden Dark Contract with the Swamp King", 1], ["Contract Laundering", 1],
    ["D/D/D Human Resources", 1], ["Dark Contract with Errors", 1], ["Dark Contract with the Eternal Darkness", 1], ["D/D/D Fusion", 1],
    ["Dark Contract with Exclusivity", 1],
    ["D/D/D Contract Change", 1], ["Dark Contract with the Witch", 1], ["Dark Contract with Renewal", 1]], x: [
    ["D/D/D Dragonbane King Beowulf", 1], ["D/D/D Flame High King Genghis", 1], ["D/D/D Flame King Genghis", 1], ["D/D/D Oracle King d'Arc", 1],
    ["D/D/D Super Doom King Purple Armageddon", 1], ["D/D/D Wave Oblivion King Caesar Ragnarok", 1], ["D/D/D Cursed King Siegfried", 1],
    ["D/D/D Gust High King Alexander", 1], ["D/D/D Gust King Alexander", 1], ["D/D/D Duo-Dawn King Kali Yuga", 1], ["D/D/D Marksman King Tell", 1],
    ["D/D/D Stone King Darius", 1], ["D/D/D Super Doom King Dark Armageddon", 1], ["D/D/D Wave High King Caesar", 1], ["D/D/D Wave King Caesar", 1]] },
  { t: "藤木遊作（Playmaker）", s: "遊☆戯☆王VRAINS", m: [
    ["Cyberse Wizard", 1], ["Bitrooper", 1], ["Backup Secretary", 1], ["Cyberse Gadget", 1], ["Draconnet", 1], ["Dual Assembwurm", 1], ["Stack Reviver", 1],
    ["Defcon Bird", 1], ["Cyberse Synchron", 1], ["Dotscaper", 1], ["Clock Wyvern", 1], ["Linkslayer", 1], ["Cyberse White Hat", 1], ["ROM Cloudia", 1],
    ["RAM Clouder", 1], ["Balancer Lord", 1], ["Micro Coder", 1], ["Widget Kid", 1], ["Code Generator", 1], ["Firewall Guardian", 1], ["Lockout Gardna", 1],
    ["Bitron", 2], ["Cyberse Magician", 1],
    ["Cynet Optimization", 1], ["Cynet Mining", 1], ["Cynet Universe", 1], ["Cynet Fusion", 1], ["Cynet Backdoor", 1], ["Cynet Ritual", 1], ["Cynet Codec", 1],
    ["Cynet Storm", 1], ["Link Back", 1],
    ["Cyberse Beacon", 1], ["Cynet Refresh", 1], ["Link Restart", 1], ["Recoded Alive", 1], ["Three Strikes Barrier", 1], ["Transaction Rollback", 1], ["Code Hack", 1]], x: [
    ["Decode Talker", 1], ["Encode Talker", 1], ["Powercode Talker", 1], ["Transcode Talker", 1], ["Shootingcode Talker", 1], ["Firewall Dragon", 1],
    ["Firewall Dragon Darkfluid", 1], ["Link Spider", 1], ["Honeybot", 1], ["Decode Talker Extended", 1], ["Firewall eXceed Dragon", 1],
    ["Cyberse Quantum Dragon", 1], ["Accesscode Talker", 1], ["Cyberse Clock Dragon", 1], ["Code Talker", 1]] },
  { t: "鴻上了見（リボルバー）", s: "遊☆戯☆王VRAINS", m: [
    ["Anesthrokket Dragon", 3], ["Autorokket Dragon", 3], ["Magnarokket Dragon", 3], ["Shelrokket Dragon", 3], ["Sniffer Dragon", 3], ["Metalrokket Dragon", 2],
    ["Absorouter Dragon", 1], ["Background Dragon", 1], ["Checksum Dragon", 1], ["Chobham Armor Dragon", 1], ["Cracking Dragon", 1], ["DMZ Dragon", 1],
    ["Defrag Dragon", 1], ["Gateway Dragon", 1], ["Silverrokket Dragon", 1], ["Rokket Recharger", 1], ["Rokket Synchron", 1], ["Triggering Wurm", 1],
    ["Boot Sector Launch", 1], ["Borrel Regenerator", 1], ["Dragonoid Generator", 1], ["Quick Launch", 1], ["Squib Draw", 1],
    ["Borrel Cooling", 1], ["Imperial Order", 1], ["Link Turret", 1], ["Mirror Force", 1], ["Red Reboot", 1], ["Remote Rebirth", 1]], x: [
    ["Booster Dragon", 1], ["Borrelguard Dragon", 1], ["Borreload Dragon", 1], ["Borrelsword Dragon", 1], ["Dillingerous Dragon", 1], ["Flash Charge Dragon", 1],
    ["Miniborrel Dragon", 1], ["Quadborrel Dragon", 1], ["Topologic Bomber Dragon", 1], ["Topologic Gumblar Dragon", 1], ["Topologic Trisbaena", 1],
    ["Topologic Zeroboros", 1], ["Triple Burst Dragon", 1], ["Twin Triangle Dragon", 1], ["Borreload Savage Dragon", 1]] },
];
