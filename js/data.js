/* ============================================================
   誓约竞技场 · data.js —— 全部可调数值与文案（纯数据）
   ============================================================ */
'use strict';
window.OO = window.OO || {};
OO.data = {
  version: 1,

  /* 物品展示信息 */
  items: {
    HealPotion:       { name: '生命药剂', short: '治疗', color: '#ff4d6d', glow: '#ff8fa3', stat: '恢复', unit: '体力', desc: '恢复目标体力，不超过上限。' },
    AbsorptionPotion: { name: '金盾药剂', short: '护盾', color: '#ffc94d', glow: '#ffe8a3', stat: '护盾', unit: '附加体力', desc: '为目标增加附加体力（护盾，无上限，受伤时最先扣除）。' },
    DamagePotion:     { name: '噬魂毒瓶', short: '魔伤', color: '#a64dff', glow: '#d4a3ff', stat: '魔法伤害', unit: '', desc: '投掷造成魔法伤害，无视护甲与攻击力。' },
    StrengthPotion:   { name: '狂战药剂', short: '力量', color: '#ff7a1a', glow: '#ffb070', stat: '攻击', unit: '基础攻击', desc: '永久提升目标的基础攻击。' },
    Sword:            { name: '长剑', short: '剑', color: '#cfe8ff', glow: '#9fd0ff', stat: '增伤', unit: '', desc: '握在主手时，物理攻击额外增伤，并削弱对方护甲减免。每次攻击消耗等同伤害值的耐久。不可“使用”。' },
    Helmet:           { name: '头盔', short: '盔', color: '#c9d3e0', glow: '#e6eef8', stat: '护甲', unit: '', desc: '握在主手对自己“使用”即可穿戴到头盔栏。' },
    Chestplate:       { name: '胸甲', short: '甲', color: '#c9d3e0', glow: '#e6eef8', stat: '护甲', unit: '', desc: '握在主手对自己“使用”即可穿戴到胸甲栏。' },
    Leggings:         { name: '护腿', short: '腿', color: '#c9d3e0', glow: '#e6eef8', stat: '护甲', unit: '', desc: '握在主手对自己“使用”即可穿戴到护腿栏。' },
    Boots:            { name: '战靴', short: '靴', color: '#c9d3e0', glow: '#e6eef8', stat: '护甲', unit: '', desc: '握在主手对自己“使用”即可穿戴到靴子栏。' },
  },
  potionTypes: ['HealPotion', 'AbsorptionPotion', 'DamagePotion', 'StrengthPotion'],
  armorTypes: ['Helmet', 'Chestplate', 'Leggings', 'Boots'],
  armorSlot: { Helmet: 36, Chestplate: 37, Leggings: 38, Boots: 39 },

  rarity: [
    { key: 'common', name: '普通', color: '#c8ccd4', mul: 1.0, w: 50 },
    { key: 'fine',   name: '精良', color: '#5ee08a', mul: 1.3, w: 30 },
    { key: 'rare',   name: '稀有', color: '#4da6ff', mul: 1.7, w: 14 },
    { key: 'epic',   name: '史诗', color: '#c66bff', mul: 2.2, w: 5 },
    { key: 'legend', name: '传说', color: '#ffb42e', mul: 3.0, w: 1 },
  ],

  /* 掉落基础值（会乘 rarity.mul 与轮次成长 1 + round*growth） */
  loot: {
    growth: 0.09,
    weights: { HealPotion: 13, AbsorptionPotion: 10, DamagePotion: 17, StrengthPotion: 13, Sword: 15, Helmet: 6, Chestplate: 6, Leggings: 6, Boots: 6 },
    potion: { HealPotion: [170, 270], AbsorptionPotion: [120, 200], DamagePotion: [190, 300], StrengthPotion: [18, 32] },
    sword: { value: [18, 34], dur: [700, 1300] },
    armor: { value: [3, 6], dur: [900, 1700] },
  },

  /* 角色 */
  hero: {
    id: 'Hero', title: '誓约者', archetype: 'knight',
    palette: { cloak: '#c8962e', cloak2: '#6b4512', body: '#2b3550', skin: '#f0c9a0', hair: '#f3e1b0', accent: '#ffd36b', eye: '#7fd4ff' },
    hp: 900, max: 900, shield: 120, atk: 125,
    kit: [
      ['equipment', 'Sword', 'sword', 28, 1500],
      ['potion', 'HealPotion', 'heal', 380],
      ['potion', 'AbsorptionPotion', 'shield', 260],
      ['potion', 'DamagePotion', 'venom', 240],
      ['equipment', 'Helmet', 'helm', 5, 1600],
    ],
  },
  rivals: [
    { id: 'Kael', name: '凯尔', title: '烬刃狂战', archetype: 'berserker',
      palette: { cloak: '#b3242f', cloak2: '#4a0c12', body: '#3a2622', skin: '#d9a07a', hair: '#2a1410', accent: '#ff6a3d', eye: '#ffb347' },
      hp: 800, max: 800, shield: 0, atk: 160, ai: { aggro: 0.9, potionLove: 0.3, loyalty: 0.5, heal: 0.4 },
      kit: [['equipment', 'Sword', 'blade', 34, 1300], ['potion', 'StrengthPotion', 'rage', 20], ['potion', 'HealPotion', 'heal', 300]] },
    { id: 'Mira', name: '米拉', title: '星咏术士', archetype: 'mage',
      palette: { cloak: '#5b3bb8', cloak2: '#1e1048', body: '#2a2045', skin: '#f2d4c4', hair: '#d9d0ff', accent: '#b98cff', eye: '#e6c6ff' },
      hp: 720, max: 720, shield: 120, atk: 100, ai: { aggro: 0.6, potionLove: 0.9, loyalty: 0.7, heal: 0.5 },
      kit: [['potion', 'DamagePotion', 'hex', 260], ['potion', 'AbsorptionPotion', 'ward', 240], ['potion', 'HealPotion', 'heal', 320]] },
    { id: 'Thorn', name: '索恩', title: '铁壁守卫', archetype: 'guardian',
      palette: { cloak: '#2f5f8f', cloak2: '#0f2238', body: '#3a4455', skin: '#c99a78', hair: '#5a4632', accent: '#7fc8ff', eye: '#bfe6ff' },
      hp: 920, max: 920, shield: 0, atk: 108, ai: { aggro: 0.5, potionLove: 0.4, loyalty: 0.9, heal: 0.45 },
      kit: [['equipment', 'Chestplate', 'plate', 6, 2200], ['equipment', 'Sword', 'mace', 22, 1500], ['potion', 'HealPotion', 'heal', 280]],
      equip: ['Chestplate'] },
    { id: 'Vex', name: '维克丝', title: '影刺游侠', archetype: 'rogue',
      palette: { cloak: '#1f7a5a', cloak2: '#08291f', body: '#1d2a2a', skin: '#e0b896', hair: '#0d0d12', accent: '#4dffb0', eye: '#7dffc8' },
      hp: 780, max: 780, shield: 0, atk: 150, ai: { aggro: 0.8, potionLove: 0.6, loyalty: 0.3, heal: 0.4 },
      kit: [['equipment', 'Sword', 'dagger', 30, 1100], ['potion', 'DamagePotion', 'toxin', 230], ['potion', 'HealPotion', 'heal', 300]] },
    { id: 'Brann', name: '布兰', title: '霜须老兵', archetype: 'veteran',
      palette: { cloak: '#8a8f99', cloak2: '#2c2f36', body: '#3d3530', skin: '#e3b48f', hair: '#e8ecf2', accent: '#bfefff', eye: '#a8e6ff' },
      hp: 960, max: 960, shield: 120, atk: 138, ai: { aggro: 0.6, potionLove: 0.5, loyalty: 0.8, heal: 0.5 },
      kit: [['equipment', 'Sword', 'axe', 26, 1400], ['equipment', 'Helmet', 'helm', 4, 1500], ['potion', 'AbsorptionPotion', 'ward', 240], ['potion', 'HealPotion', 'heal', 300]],
      equip: ['Helmet'] },
  ],

  /* 开局随机盟约（load_subscribe 文法），按对手数量挑选 */
  openingPacts: {
    3: ['Mira(Thorn(Mira))', 'Kael(Mira)'],
    4: ['Mira(Thorn(Mira))', 'Vex(Kael(Vex))', 'Thorn(Mira),Kael'],
    5: ['Mira(Thorn(Mira))', 'Vex(Kael(Vex))', 'Brann(Thorn(Brann))'],
  },

  /* 新手引导场景 */
  tutorial: {
    mentor: { id: 'Elin', name: '艾琳', title: '引导者', archetype: 'mage',
      palette: { cloak: '#e6f0ff', cloak2: '#6d86b3', body: '#3b4a6b', skin: '#f5dcc8', hair: '#fff4d6', accent: '#9fe0ff', eye: '#9fe0ff' },
      hp: 900, max: 900, shield: 0, atk: 40 },
    golem: { id: 'Golem', name: '试炼石像', title: '训练傀儡', archetype: 'golem',
      palette: { cloak: '#55606e', cloak2: '#20262e', body: '#6b7380', skin: '#8a94a3', hair: '#3a414b', accent: '#5ef0ff', eye: '#5ef0ff' },
      hp: 700, max: 700, shield: 0, atk: 60 },
  },

  speeds: [1, 1.6, 2.4],
};
