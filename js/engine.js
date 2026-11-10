/* ============================================================
   誓约竞技场 · engine.js
   —— OOpre 最终版 Java 源码（src/*.java）的逐类 JS 移植。
   规则、顺序、输出格式与 Java 版完全一致（见 tools/difftest.js 对拍）。
   唯一的新增：在状态变化处 emit 事件，供画面层播放动画；
   事件只读取状态，不改变任何逻辑。
   ============================================================ */
'use strict';
(function (root) {
  const OO = root.OO || (root.OO = {});

  /* ---------------- Item.java ---------------- */
  class Item {
    constructor(itemId) { this.setId(itemId); }
    getId() { return this.id; }
    setId(itemId) {
      if (itemId == null || String(itemId).trim() === '') throw new Error('属性标识符不能为空');
      if (itemId.length > 40) throw new Error('属性标识符过长');
      this.id = itemId;
    }
    getType() { throw new Error('abstract'); }
    isUsable() { return false; }          // 对应 Java 的 instanceof Usable
  }

  /* ---------------- Potion.java ---------------- */
  class Potion extends Item {
    constructor(itemId, amplifier) { super(itemId); this.setAmplifier(amplifier); }
    getAmplifier() { return this.amplifier; }
    setAmplifier(a) {
      if (a < 1 || a > 5000) throw new Error('药水效果等级不在给定范围内[1,5000]');
      this.amplifier = a;
    }
    isUsable() { return true; }
  }
  class HealPotion extends Potion {
    use(target) { target.heal(this.getAmplifier()); }
    getType() { return 'HealPotion'; }
  }
  class AbsorptionPotion extends Potion {
    use(target) { target.addExtraHitPoint(this.getAmplifier()); }
    getType() { return 'AbsorptionPotion'; }
  }
  class DamagePotion extends Potion {
    use(target) { target.damage(this.getAmplifier()); }
    getType() { return 'DamagePotion'; }
  }
  class StrengthPotion extends Potion {
    use(target) { target.addBaseAttackDamage(this.getAmplifier()); }
    getType() { return 'StrengthPotion'; }
  }

  /* ---------------- Equipment.java ---------------- */
  class Equipment extends Item {
    constructor(itemId, durability, equipmentValue) {
      super(itemId);
      this.setDurability(durability);
      this.setEquipmentValue(equipmentValue);
    }
    setDurability(d) {
      if (d < 1 || d > 200000) throw new Error('装备耐久度不在给定范围内[1,200000]');
      this.durability = d;
    }
    setEquipmentValue(v) {
      if (v < 0 || v > 200000) throw new Error('装备主属性不在给定范围内[0,200000]');
      this.equipmentValue = v;
    }
    getDurability() { return this.durability; }
    getEquipmentValue() { return this.equipmentValue; }
    consumeDurability(amount) { this.durability = (this.durability - amount) | 0; }
    isBroken() { return this.durability <= 0; }
  }
  class Sword extends Equipment { getType() { return 'Sword'; } }
  class Helmet extends Equipment {
    isUsable() { return true; }
    use(target) { target.equipItem(this, Inventory.HELMET_SLOT); }
    getType() { return 'Helmet'; }
  }
  class Chestplate extends Equipment {
    isUsable() { return true; }
    use(target) { target.equipItem(this, Inventory.CHESTPLATE_SLOT); }
    getType() { return 'Chestplate'; }
  }
  class Leggings extends Equipment {
    isUsable() { return true; }
    use(target) { target.equipItem(this, Inventory.LEGGINGS_SLOT); }
    getType() { return 'Leggings'; }
  }
  class Boots extends Equipment {
    isUsable() { return true; }
    use(target) { target.equipItem(this, Inventory.BOOTS_SLOT); }
    getType() { return 'Boots'; }
  }

  /* ---------------- Inventory.java ---------------- */
  class Inventory {
    constructor() {
      this.slots = new Array(Inventory.TOTAL_SLOTS).fill(null);
      this.idToSlot = new Map();
    }
    addItem(item) {
      for (let i = 0; i < Inventory.NORMAL_SLOT_COUNT; i++) {
        if (this.slots[i] === null) {
          this.slots[i] = item;
          this.idToSlot.set(item.getId(), i);
          return i;
        }
      }
      return -1;
    }
    findItem(itemId) {
      const slot = this.idToSlot.get(itemId);
      return slot !== undefined ? this.slots[slot] : null;
    }
    slotOf(itemId) { const s = this.idToSlot.get(itemId); return s === undefined ? -1 : s; } // 只读辅助
    removeItem(itemId) {
      const slot = this.idToSlot.get(itemId);
      if (slot === undefined) return null;
      const removed = this.slots[slot];
      this.slots[slot] = null;
      this.idToSlot.delete(itemId);
      return removed;
    }
    getItem(slot) { return this.slots[slot]; }
    swap(slotA, slotB) {
      if (slotA === slotB) return;
      const itemA = this.slots[slotA], itemB = this.slots[slotB];
      if (itemA === null && itemB === null) return;
      this.slots[slotA] = itemB;
      this.slots[slotB] = itemA;
      if (itemA !== null) this.idToSlot.set(itemA.getId(), slotB);
      if (itemB !== null) this.idToSlot.set(itemB.getId(), slotA);
    }
    equip(item, equipSlot) {
      const current = this.idToSlot.get(item.getId());
      if (current === undefined) return;
      this.swap(current, equipSlot);
    }
    getItemCount() { let c = 0; for (const it of this.slots) if (it !== null) c++; return c; }
    getTypeCount() {
      const types = new Set();
      for (const it of this.slots) if (it !== null) types.add(it.getType());
      return types.size;
    }
    consumeDurabilityAtSlot(slot, amount) {
      const item = this.slots[slot];
      if (item instanceof Equipment) {
        item.consumeDurability(amount);
        if (item.isBroken()) this.removeItem(item.getId());
      }
    }
    getBestHealPotion() {
      let best = null;
      for (let i = 0; i < Inventory.NORMAL_SLOT_COUNT; i++) {
        const it = this.slots[i];
        if (it instanceof HealPotion) {
          if (best === null || it.getAmplifier() > best.getAmplifier()) best = it;
        }
      }
      return best;
    }
    getBestAbsorptionPotion() {
      let best = null;
      for (let i = 0; i < Inventory.NORMAL_SLOT_COUNT; i++) {
        const it = this.slots[i];
        if (it instanceof AbsorptionPotion) {
          if (best === null || it.getAmplifier() > best.getAmplifier()) best = it;
        }
      }
      return best;
    }
    clear() {
      for (let i = 0; i < Inventory.TOTAL_SLOTS; i++) this.slots[i] = null;
      this.idToSlot.clear();
    }
  }
  Inventory.NORMAL_SLOT_COUNT = 36;
  Inventory.HELMET_SLOT = 36;
  Inventory.CHESTPLATE_SLOT = 37;
  Inventory.LEGGINGS_SLOT = 38;
  Inventory.BOOTS_SLOT = 39;
  Inventory.TOTAL_SLOTS = 40;

  /* ---------------- Player.java ---------------- */
  class Player {
    constructor(name, hitPoint, maxHitPoint, extraHitPoint, baseAttackDamage) {
      this.slotId = 0;
      this.inventory = new Inventory();
      this.subscribingPlayers = [];
      this.sys = null; // 由 GameSystem 注入，仅用于输出与事件
      this.setName(name);
      this.setHitPoint(hitPoint);
      this.setMaxHitPoint(maxHitPoint);
      this.setExtraHitPoint(extraHitPoint);
      this.setBaseAttackDamage(baseAttackDamage);
      this.setSlotId(0);
    }
    heal(amount) { this.hitPoint = Math.min(this.maxHitPoint, (this.hitPoint + amount) | 0); }
    addExtraHitPoint(amount) { this.extraHitPoint = (this.extraHitPoint + amount) | 0; }

    damage(amount) {
      const oldHitPoint = this.hitPoint, oldExtra = this.extraHitPoint;
      if (this.extraHitPoint >= amount) {
        this.extraHitPoint -= amount;
      } else {
        const remain = amount - this.extraHitPoint;
        this.extraHitPoint = 0;
        if (this.hitPoint > remain) {
          this.hitPoint -= remain;
        } else {
          this.hitPoint = 0;
          this.inventory.clear();
        }
      }
      const newHitPoint = this.hitPoint;
      if (this.isDead()) this.subscribingPlayers.length = 0;
      const triggered = newHitPoint > 0 && oldHitPoint * 2 > this.maxHitPoint && newHitPoint * 2 <= this.maxHitPoint;
      if (this.sys) this.sys.emit('damage', {
        target: this.name, amount, shieldLoss: oldExtra - this.extraHitPoint,
        hpLoss: oldHitPoint - newHitPoint, died: this.isDead(), halfAlarm: triggered, snap: this.snap(),
      });
      return triggered;
    }

    addBaseAttackDamage(amount) { this.baseAttackDamage = (this.baseAttackDamage + amount) | 0; }

    attackDamage(target) {
      const a = this.baseAttackDamage;
      const d = this.getMainHandDamage();
      const v = target.getArmorValue();
      const reduce = Math.min(800, Math.max(8 * v, 40 * v - 20 * d));
      return Math.floor(((a + d) * (1000 - reduce) + 999) / 1000);
    }

    canHelp(target) { return this.dfs(this, target, new Set()); }
    dfs(player, target, visited) {
      if (visited.has(player)) return false;
      visited.add(player);
      if (player === target) return true;
      for (const f of player.subscribingPlayers) if (this.dfs(f, target, visited)) return true;
      return false;
    }
    onAidEvent(target) { if (this.canHelp(target)) this.aid(target); }
    getSubscribingPlayers() { return this.subscribingPlayers; }

    aid(target) {
      let potionToUse = null;
      if (target.getHitPoint() < target.getMaxHitPoint()) potionToUse = this.inventory.getBestHealPotion();
      if (potionToUse === null) potionToUse = this.inventory.getBestAbsorptionPotion();
      if (potionToUse !== null) {
        const fromSlot = this.inventory.slotOf(potionToUse.getId());
        this.inventory.removeItem(potionToUse.getId());
        potionToUse.use(target);
        const line = target.getName() + ' (' + target.getHitPoint() + '/' + target.getMaxHitPoint()
          + ' +' + target.getExtraHitPoint() + ') was helped by ' + this.getName() + ' using "'
          + potionToUse.getId() + '" with item type ' + potionToUse.getType();
        if (this.sys) {
          this.sys.emit('aid', {
            helper: this.name, target: target.name, item: OO.itemInfo(potionToUse), fromSlot,
            snap: target.snap(), helperSnap: this.snap(),
          });
          this.sys.print(line);
        }
      }
    }

    addSubscriber(p) { this.subscribingPlayers.push(p); }
    getSubscribingCount() { return this.subscribingPlayers.length; }
    clearSubscribeOnDeath() { this.subscribingPlayers.length = 0; }
    removeSubscriber(p) { // ArrayList.remove(Object)：只删除第一个
      const i = this.subscribingPlayers.indexOf(p);
      if (i >= 0) this.subscribingPlayers.splice(i, 1);
    }
    addItem(item) { return this.inventory.addItem(item); }
    findItem(id) { return this.inventory.findItem(id); }
    removeItem(id) { return this.inventory.removeItem(id); }
    getItemCount() { return this.inventory.getItemCount(); }
    getName() { return this.name; }
    getHitPoint() { return this.hitPoint; }
    getMaxHitPoint() { return this.maxHitPoint; }
    getExtraHitPoint() { return this.extraHitPoint; }
    getBaseAttackDamage() { return this.baseAttackDamage; }
    getSlotId() { return this.slotId; }

    setName(name) {
      if (name == null || String(name).trim() === '') throw new Error('玩家名不能为空');
      if (name.length > 40) throw new Error('玩家名过长');
      this.name = name;
    }
    setHitPoint(v) { if (v < 1 || v > 5000) throw new Error('玩家属性体力不在给定范围内[1,5000]'); this.hitPoint = v; }
    setMaxHitPoint(v) { if (v < 1 || v > 5000) throw new Error('玩家最大体力不在给定范围内[1,5000]'); this.maxHitPoint = v; }
    setExtraHitPoint(v) { if (v < 0 || v > 5000) throw new Error('玩家附加体力不在给定范围内[0,5000]'); this.extraHitPoint = v; }
    setBaseAttackDamage(v) { if (v < 1 || v > 200000) throw new Error('玩家基础攻击不在给定范围内[1,200000]'); this.baseAttackDamage = v; }
    setSlotId(v) { if (v < 0 || v > 8) throw new Error('玩家主槽位不在给定范围内[0,8]'); this.slotId = v; }

    swapSlots(a, b) { this.inventory.swap(a, b); }
    equipItem(item, equipSlot) { this.inventory.equip(item, equipSlot); }
    getMainHandItem() { return this.inventory.getItem(this.slotId); }
    getMainHandDamage() {
      const it = this.getMainHandItem();
      return it instanceof Sword ? it.getEquipmentValue() : 0;
    }
    getArmorValue() {
      let c = 0;
      for (let i = Inventory.HELMET_SLOT; i < Inventory.TOTAL_SLOTS; i++) {
        const it = this.inventory.getItem(i);
        if (it instanceof Equipment) c += it.getEquipmentValue();
      }
      return c;
    }
    consumeMainHandDurability(amount) { this._consume(this.slotId, amount); }
    consumeArmorDurability(amount) {
      this._consume(Inventory.HELMET_SLOT, amount);
      this._consume(Inventory.CHESTPLATE_SLOT, amount);
      this._consume(Inventory.LEGGINGS_SLOT, amount);
      this._consume(Inventory.BOOTS_SLOT, amount);
    }
    _consume(slot, amount) { // = inventory.consumeDurabilityAtSlot + 事件
      const it = this.inventory.getItem(slot);
      const before = it instanceof Equipment ? it.getDurability() : 0;
      this.inventory.consumeDurabilityAtSlot(slot, amount);
      if (it instanceof Equipment && this.sys) {
        this.sys.emit('durability', {
          player: this.name, slot, item: OO.itemInfo(it), before, after: it.getDurability(),
          broken: it.isBroken(), snap: this.snap(),
        });
      }
    }

    getInfo() {
      if (this.isDead()) {
        return this.name + ' dead 0/' + this.maxHitPoint + ' +' + this.extraHitPoint
          + ' baseAtk=' + this.baseAttackDamage + ' with 0 item(s) with 0 type(s)';
      }
      return this.name + ' alive ' + this.hitPoint + '/' + this.maxHitPoint + ' +' + this.extraHitPoint
        + ' baseAtk=' + this.baseAttackDamage + ' with ' + this.getItemCount() + ' item(s) with '
        + this.inventory.getTypeCount() + ' type(s)';
    }
    isDead() { return this.hitPoint <= 0; }

    /* 只读快照：画面层用来同步“显示状态” */
    snap() {
      const inv = this.inventory, armor = [];
      for (let i = 36; i < 40; i++) { const it = inv.getItem(i); armor.push(it ? OO.itemInfo(it) : null); }
      const hand = inv.getItem(this.slotId);
      return {
        name: this.name, hp: this.hitPoint, max: this.maxHitPoint, shield: this.extraHitPoint,
        atk: this.baseAttackDamage, alive: !this.isDead(), slotId: this.slotId,
        hand: hand ? OO.itemInfo(hand) : null, armor, armorValue: this.getArmorValue(),
        items: inv.getItemCount(), subs: this.subscribingPlayers.map(p => p.name),
      };
    }
  }

  /* ---------------- Lexer.java ---------------- */
  class Lexer {
    constructor(input) { this.input = input.replace(/\s+/g, ''); this.pos = 0; this.curToken = null; this.next(); }
    isIDChar(c) { return /[\p{L}\p{Nd}_]/u.test(c); }
    getID() {
      let s = '';
      while (this.pos < this.input.length && this.isIDChar(this.input[this.pos])) s += this.input[this.pos++];
      return s;
    }
    next() {
      if (this.pos === this.input.length) { this.curToken = null; return; }
      const c = this.input[this.pos];
      if (this.isIDChar(c)) this.curToken = this.getID();
      else if (c === '(' || c === ')' || c === ',') { this.pos += 1; this.curToken = c; }
      else throw new Error('Unexpected character: ' + c);
    }
    peek() { return this.curToken; }
  }

  /* ---------------- Parser.java ---------------- */
  class Parser {
    constructor(lexer, system) { this.lexer = lexer; this.system = system; }
    parseStructure() { this.parsePlayer(null); }
    parsePlayer(parent) {
      const name = this.lexer.peek();
      const current = this.system.findPlayer(name);
      if (parent !== null) {
        parent.addSubscriber(current);
        this.system.emit('subscribe', { from: parent.name, to: name, count: parent.getSubscribingCount(), viaLoad: true });
      }
      this.lexer.next();
      if (this.lexer.peek() === '(') {
        this.lexer.next();
        this.parsePlayer(current);
        while (this.lexer.peek() === ',') { this.lexer.next(); this.parsePlayer(current); }
        if (this.lexer.peek() === ')') this.lexer.next();
      }
    }
  }

  /* ---------------- GameSystem.java ---------------- */
  class GameSystem {
    constructor() {
      this.playerList = [];
      this.output = [];           // 与 System.out 等价的输出行
      this.listeners = [];
      this.events = [];           // 本条指令产生的事件序列
    }
    /* —— 输出与事件（非原逻辑，仅观察） —— */
    print(line) { this.output.push(line); this.emit('print', { line }); }
    emit(type, data) {
      const ev = Object.assign({ type }, data);
      this.events.push(ev);
      for (const fn of this.listeners) fn(ev);
    }
    on(fn) { this.listeners.push(fn); }

    run(lines) { // 对应 Java run()：首行 n，之后 n 条
      const n = parseInt(lines[0].trim(), 10);
      for (let i = 1; i <= n; i++) this.execute(lines[i]);
      return this.output;
    }

    /* 执行一条指令，返回 { lines, events } */
    execute(line) {
      this.events = [];
      const outStart = this.output.length;
      this.emit('command', { line: line.trim() });
      const tokens = line.trim().split(/\s+/);
      const type = tokens[0];
      const I = s => parseInt(s, 10);
      switch (type) {
        case 'add_player': this.addPlayer(tokens[1], I(tokens[2]), I(tokens[3]), I(tokens[4]), I(tokens[5])); break;
        case 'add_potion': this.addPotion(tokens[1], tokens[2], tokens[3], I(tokens[4])); break;
        case 'add_equipment': this.addEquipment(tokens[1], tokens[2], tokens[3], I(tokens[4]), I(tokens[5])); break;
        case 'remove_item': this.removeItem(tokens[1], tokens[2]); break;
        case 'use_item': this.useItem(tokens[1], tokens[2]); break;
        case 'query': this.print(this.findPlayer(tokens[1]).getInfo()); break;
        case 'change_slot': this.changeSlot(tokens[1], I(tokens[2])); break;
        case 'attack': this.attack(tokens[1], tokens[2]); break;
        case 'swap': this.swapSlots(tokens[1], I(tokens[2]), I(tokens[3])); break;
        case 'add_subscribe': this.addSubscribe(tokens[1], tokens[2]); break;
        case 'remove_subscribe': this.removeSubscribe(tokens[1], tokens[2]); break;
        case 'load_subscribe': this.loadSubscribe(line.trim().substring(tokens[0].length).trim()); break;
        default: break;
      }
      return { lines: this.output.slice(outStart), events: this.events };
    }

    triggerAidEvent(target) {
      const reverse = new Map();
      for (const p of this.playerList) {
        for (const sub of p.getSubscribingPlayers()) {
          if (!reverse.has(sub)) reverse.set(sub, []);
          reverse.get(sub).push(p);
        }
      }
      const helpers = new Set([target]);
      const queue = [target];
      while (queue.length) {
        const cur = queue.shift();
        for (const from of (reverse.get(cur) || [])) {
          if (!helpers.has(from)) { helpers.add(from); queue.push(from); }
        }
      }
      this.emit('aidAlert', {
        target: target.name, helpers: this.playerList.filter(p => helpers.has(p)).map(p => p.name),
        snap: target.snap(),
      });
      for (const p of this.playerList) if (helpers.has(p)) p.aid(target);
    }

    findPlayer(name) {
      for (const p of this.playerList) if (p.getName() === name) return p;
      return null;
    }

    addPlayer(name, hp, maxHp, extra, atk) {
      const p = new Player(name, hp, maxHp, extra, atk);
      p.sys = this;
      this.playerList.push(p);
      this.emit('playerAdded', { player: name, snap: p.snap(), index: this.playerList.length - 1 });
    }

    _deadCheck(name, player) {
      if (player === null || player.isDead()) {
        if (player !== null && player.isDead()) this.print(name + ' is dead!');
        return true;
      }
      return false;
    }

    addPotion(name, itemId, potionType, amplifier) {
      const player = this.findPlayer(name);
      if (this._deadCheck(name, player)) return;
      let potion;
      switch (potionType) {
        case 'HealPotion': potion = new HealPotion(itemId, amplifier); break;
        case 'AbsorptionPotion': potion = new AbsorptionPotion(itemId, amplifier); break;
        case 'DamagePotion': potion = new DamagePotion(itemId, amplifier); break;
        case 'StrengthPotion': potion = new StrengthPotion(itemId, amplifier); break;
        default: throw new Error('Unknown potion type: ' + potionType);
      }
      this._afterAdd(player, name, potion, itemId);
    }

    addEquipment(name, itemId, equipmentType, equipmentValue, durability) {
      const player = this.findPlayer(name);
      if (this._deadCheck(name, player)) return;
      let eq;
      switch (equipmentType) {
        case 'Helmet': eq = new Helmet(itemId, durability, equipmentValue); break;
        case 'Chestplate': eq = new Chestplate(itemId, durability, equipmentValue); break;
        case 'Leggings': eq = new Leggings(itemId, durability, equipmentValue); break;
        case 'Boots': eq = new Boots(itemId, durability, equipmentValue); break;
        case 'Sword': eq = new Sword(itemId, durability, equipmentValue); break;
        default: throw new Error('Unknown equipment type: ' + equipmentType);
      }
      this._afterAdd(player, name, eq, itemId);
    }

    _afterAdd(player, name, item, itemId) {
      const slot = player.addItem(item);
      if (slot >= 0) {
        this.emit('itemAdded', { player: name, item: OO.itemInfo(item), slot, snap: player.snap() });
        this.print(String(slot));
      } else {
        this.emit('inventoryFull', { player: name, item: OO.itemInfo(item) });
        this.print(name + ' failed to get item ' + itemId + ' because they have a full inventory');
      }
    }

    removeItem(name, itemId) {
      const player = this.findPlayer(name);
      if (player === null) return;
      if (player.isDead()) { this.print(name + ' is dead!'); return; }
      const slot = player.inventory.slotOf(itemId);
      const item = player.removeItem(itemId);
      if (item !== null) {
        this.emit('itemRemoved', { player: name, item: OO.itemInfo(item), slot, snap: player.snap() });
        this.print(player.getItemCount() + ' ' + item.getType());
      }
    }

    useItem(userName, targetName) {
      const user = this.findPlayer(userName), target = this.findPlayer(targetName);
      if (user === null || target === null) return;
      if (user.isDead()) { this.print(userName + ' is dead!'); return; }
      if (target.isDead()) { this.print(targetName + ' is dead!'); return; }
      const item = user.getMainHandItem();
      if (item === null) { this.print(userName + ' has nothing on hand'); return; }
      const itemId = item.getId();
      if (!item.isUsable()) {
        this.emit('notUsable', { user: userName, target: targetName, item: OO.itemInfo(item) });
        this.print(userName + ' failed to use ' + itemId + ' to ' + targetName + ' because it is not Usable');
        return;
      }
      this.emit('use', { user: userName, target: targetName, item: OO.itemInfo(item), slot: user.slotId });
      if (item instanceof DamagePotion) {
        const amount = item.getAmplifier();
        const triggered = target.damage(amount);
        if (target.isDead()) this.handleDeath(target);
        else if (triggered) this.triggerAidEvent(target);
        user.removeItem(item.getId());
      } else {
        item.use(target);
        if (item instanceof Potion) user.removeItem(item.getId());
      }
      this.emit('used', { user: userName, target: targetName, item: OO.itemInfo(item), snap: target.snap(), userSnap: user.snap() });
      this.print(target.getInfo());
    }

    changeSlot(name, slotId) {
      const player = this.findPlayer(name);
      if (player === null) return;
      if (player.isDead()) { this.print(name + ' is dead!'); return; }
      player.setSlotId(slotId);
      this.emit('slot', { player: name, slotId, snap: player.snap() });
    }

    attack(attackerName, targetName) {
      const attacker = this.findPlayer(attackerName), target = this.findPlayer(targetName);
      if (attacker === null || target === null) return;
      if (attacker.isDead()) { this.print(attackerName + ' is dead!'); return; }
      if (target.isDead()) { this.print(targetName + ' is dead!'); return; }
      const amount = attacker.attackDamage(target);
      this.emit('attack', {
        attacker: attackerName, target: targetName, damage: amount,
        a: attacker.getBaseAttackDamage(), d: attacker.getMainHandDamage(), v: target.getArmorValue(),
        hand: attacker.getMainHandItem() ? OO.itemInfo(attacker.getMainHandItem()) : null,
      });
      attacker.consumeMainHandDurability(amount);
      target.consumeArmorDurability(amount);
      const trigger = target.damage(amount);
      if (target.isDead()) this.handleDeath(target);
      else if (trigger) this.triggerAidEvent(target);
      this.print(target.getInfo());
    }

    swapSlots(name, a, b) {
      const player = this.findPlayer(name);
      if (player === null) return;
      if (player.isDead()) { this.print(name + ' is dead!'); return; }
      player.swapSlots(a, b);
      this.emit('swap', { player: name, a, b, snap: player.snap() });
    }

    addSubscribe(nameA, nameB) {
      const A = this.findPlayer(nameA), B = this.findPlayer(nameB);
      if (A === null || B === null) return;
      if (A.isDead()) { this.print(nameA + ' is dead!'); return; }
      else if (B.isDead()) { this.print(nameB + ' is dead!'); return; }
      A.addSubscriber(B);
      this.emit('subscribe', { from: nameA, to: nameB, count: A.getSubscribingCount() });
      this.print(A.getName() + ' is now subscribing ' + B.getName() + ' with ' + A.getSubscribingCount() + ' subscribing players');
    }

    removeSubscribe(nameA, nameB) {
      const A = this.findPlayer(nameA), B = this.findPlayer(nameB);
      if (A === null || B === null) return;
      if (A.isDead()) { this.print(nameA + ' is dead!'); return; }
      else if (B.isDead()) { this.print(nameB + ' is dead!'); return; }
      A.removeSubscriber(B);
      this.emit('unsubscribe', { from: nameA, to: nameB, count: A.getSubscribingCount() });
      this.print(A.getName() + ' is now not subscribing ' + B.getName() + ' with ' + A.getSubscribingCount() + ' subscribing players');
    }

    loadSubscribe(structure) {
      this.emit('loadSubscribe', { structure });
      new Parser(new Lexer(structure), this).parseStructure();
    }

    handleDeath(dead) {
      const lost = this.playerList.filter(p => p.subscribingPlayers.includes(dead)).map(p => p.name);
      dead.clearSubscribeOnDeath();
      for (const p of this.playerList) p.removeSubscriber(dead);
      this.emit('death', { player: dead.name, snap: dead.snap(), lostFollowers: lost });
    }
  }

  OO.itemInfo = function (it) {
    const o = { id: it.getId(), type: it.getType() };
    if (it instanceof Potion) o.amp = it.getAmplifier();
    if (it instanceof Equipment) { o.value = it.getEquipmentValue(); o.dur = it.getDurability(); }
    return o;
  };

  Object.assign(OO, {
    Item, Potion, HealPotion, AbsorptionPotion, DamagePotion, StrengthPotion,
    Equipment, Sword, Helmet, Chestplate, Leggings, Boots,
    Inventory, Player, Lexer, Parser, GameSystem,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = OO;
})(typeof window !== 'undefined' ? window : globalThis);
