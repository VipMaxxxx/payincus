CREATE TABLE "badge_series" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "name_zh" TEXT NOT NULL,
    "name_en" TEXT,
    "description" TEXT NOT NULL,
    "source_id" TEXT,
    "source_label" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badge_series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "badges" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "full_label" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "source_id" TEXT,
    "source_label" TEXT,
    "asset_url" TEXT NOT NULL,
    "asset_url_dark" TEXT,
    "asset_url_light" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "badge_series_display_order_idx" ON "badge_series"("display_order");
CREATE INDEX "badge_series_is_active_idx" ON "badge_series"("is_active");
CREATE INDEX "badges_series_id_display_order_idx" ON "badges"("series_id", "display_order");
CREATE INDEX "badges_is_active_idx" ON "badges"("is_active");

ALTER TABLE "badges"
  ADD CONSTRAINT "badges_series_id_fkey"
  FOREIGN KEY ("series_id") REFERENCES "badge_series"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the current built-in badge catalog into the database.
INSERT INTO "badge_series" ("id", "title", "name_zh", "name_en", "description", "source_id", "source_label", "display_order", "is_active") VALUES
('supreme', '👑 SUPREME 尊贵系列', '尊贵系列', 'SUPREME', '极致尊贵的云实例，代表统治级的算力引擎与物理机。', 'core', '核心科幻', 100, true),
('celestial', '🌌 CELESTIAL 行星系列', '行星系列', 'CELESTIAL', '浩瀚宇宙的星辰与奇观，赋予架构无尽的拓展想象。', 'core', '核心科幻', 200, true),
('aegis', '🛡️ AEGIS 防御装甲', '防御装甲', 'AEGIS', '重金属质感与几何堡垒的结合，代表高防节点与零信任安全架构。', 'core', '核心科幻', 300, true),
('reactor', '☢️ REACTOR 能源核心', '能源核心', 'REACTOR', '狂暴流体加速与高频电涌，代表极速算力引擎与高并发枢纽。', 'core', '核心科幻', 400, true),
('tactical', '👁️ TACTICAL 战术打击', '战术打击', 'TACTICAL', '锐利视差与军事级断点扫描HUD，代表CDN加速与精准网络。', 'core', '核心科幻', 500, true),
('arcane', '✡️ ARCANE 魔能矩阵', '魔能矩阵', 'ARCANE', '神秘法阵刻印与多层逆向旋转，代表前沿AI大模型与复杂算力。', 'core', '核心科幻', 600, true),
('zodiac', '🐉 ZODIAC 生肖机甲 (五行重铸)', '生肖机甲 (五行重铸)', 'ZODIAC', '打破千篇一律，赋予金木水火土专属的色彩与硬核独立的物理动效。', 'astro-zodiac', '星相生肖', 700, true),
('astral', '✨ ASTRAL 全息星图 (四象法则)', '全息星图 (四象法则)', 'ASTRAL', '火象闪烁、水象涟漪、土象扫描、风象公转。真实坐标的完美重构。', 'astro-zodiac', '星相生肖', 800, true)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "badges" ("id", "name", "name_en", "full_label", "series_id", "source_id", "source_label", "asset_url", "asset_url_dark", "asset_url_light", "display_order", "is_active") VALUES
('elite', '精英', 'Elite', '精英 (Elite)', 'supreme', 'core', '核心科幻', '/badges/dark/elite.svg', '/badges/dark/elite.svg', '/badges/light/elite.svg', 10, true),
('ultra', '极致', 'Ultra', '极致 (Ultra)', 'supreme', 'core', '核心科幻', '/badges/dark/ultra.svg', '/badges/dark/ultra.svg', '/badges/light/ultra.svg', 20, true),
('apex', '巅峰', 'Apex', '巅峰 (Apex)', 'supreme', 'core', '核心科幻', '/badges/dark/apex.svg', '/badges/dark/apex.svg', '/badges/light/apex.svg', 30, true),
('quantum', '量子', 'Quantum', '量子 (Quantum)', 'supreme', 'core', '核心科幻', '/badges/dark/quantum.svg', '/badges/dark/quantum.svg', '/badges/light/quantum.svg', 40, true),
('titan', '泰坦', 'Titan', '泰坦 (Titan)', 'supreme', 'core', '核心科幻', '/badges/dark/titan.svg', '/badges/dark/titan.svg', '/badges/light/titan.svg', 50, true),
('omega', '终极', 'Omega', '终极 (Omega)', 'supreme', 'core', '核心科幻', '/badges/dark/omega.svg', '/badges/dark/omega.svg', '/badges/light/omega.svg', 60, true),
('matrix', '矩阵', 'Matrix', '矩阵 (Matrix)', 'supreme', 'core', '核心科幻', '/badges/dark/matrix.svg', '/badges/dark/matrix.svg', '/badges/light/matrix.svg', 70, true),
('vanguard', '先锋', 'Vanguard', '先锋 (Vanguard)', 'supreme', 'core', '核心科幻', '/badges/dark/vanguard.svg', '/badges/dark/vanguard.svg', '/badges/light/vanguard.svg', 80, true),
('genesis', '创世', 'Genesis', '创世 (Genesis)', 'supreme', 'core', '核心科幻', '/badges/dark/genesis.svg', '/badges/dark/genesis.svg', '/badges/light/genesis.svg', 90, true),
('nexus', '枢纽', 'Nexus', '枢纽 (Nexus)', 'supreme', 'core', '核心科幻', '/badges/dark/nexus.svg', '/badges/dark/nexus.svg', '/badges/light/nexus.svg', 100, true),
('solaris', '恒星', 'Solaris', '恒星 (Solaris)', 'celestial', 'core', '核心科幻', '/badges/dark/solaris.svg', '/badges/dark/solaris.svg', '/badges/light/solaris.svg', 110, true),
('earth', '地球', 'Earth', '地球 (Earth)', 'celestial', 'core', '核心科幻', '/badges/dark/earth.svg', '/badges/dark/earth.svg', '/badges/light/earth.svg', 120, true),
('moon', '月球', 'Luna', '月球 (Luna)', 'celestial', 'core', '核心科幻', '/badges/dark/moon.svg', '/badges/dark/moon.svg', '/badges/light/moon.svg', 130, true),
('ares', '火星', 'Ares', '火星 (Ares)', 'celestial', 'core', '核心科幻', '/badges/dark/ares.svg', '/badges/dark/ares.svg', '/badges/light/ares.svg', 140, true),
('jupiter', '木星', 'Jupiter', '木星 (Jupiter)', 'celestial', 'core', '核心科幻', '/badges/dark/jupiter.svg', '/badges/dark/jupiter.svg', '/badges/light/jupiter.svg', 150, true),
('cronus', '土星', 'Cronus', '土星 (Cronus)', 'celestial', 'core', '核心科幻', '/badges/dark/cronus.svg', '/badges/dark/cronus.svg', '/badges/light/cronus.svg', 160, true),
('uranus', '天王星', 'Uranus', '天王星 (Uranus)', 'celestial', 'core', '核心科幻', '/badges/dark/uranus.svg', '/badges/dark/uranus.svg', '/badges/light/uranus.svg', 170, true),
('neptune', '海王星', 'Neptune', '海王星 (Neptune)', 'celestial', 'core', '核心科幻', '/badges/dark/neptune.svg', '/badges/dark/neptune.svg', '/badges/light/neptune.svg', 180, true),
('pluto', '冥王星', 'Pluto', '冥王星 (Pluto)', 'celestial', 'core', '核心科幻', '/badges/dark/pluto.svg', '/badges/dark/pluto.svg', '/badges/light/pluto.svg', 190, true),
('blackhole', '黑洞', 'Black Hole', '黑洞 (Black Hole)', 'celestial', 'core', '核心科幻', '/badges/dark/blackhole.svg', '/badges/dark/blackhole.svg', '/badges/light/blackhole.svg', 200, true),
('mercury', '水星', 'Mercury', '水星 (Mercury)', 'celestial', 'core', '核心科幻', '/badges/dark/mercury.svg', '/badges/dark/mercury.svg', '/badges/light/mercury.svg', 210, true),
('nebula', '星云', 'Nebula', '星云 (Nebula)', 'celestial', 'core', '核心科幻', '/badges/dark/nebula.svg', '/badges/dark/nebula.svg', '/badges/light/nebula.svg', 220, true),
('pulsar', '脉冲星', 'Pulsar', '脉冲星 (Pulsar)', 'celestial', 'core', '核心科幻', '/badges/dark/pulsar.svg', '/badges/dark/pulsar.svg', '/badges/light/pulsar.svg', 230, true),
('wormhole', '虫洞', 'Wormhole', '虫洞 (Wormhole)', 'celestial', 'core', '核心科幻', '/badges/dark/wormhole.svg', '/badges/dark/wormhole.svg', '/badges/light/wormhole.svg', 240, true),
('galaxy', '星系', 'Galaxy', '星系 (Galaxy)', 'celestial', 'core', '核心科幻', '/badges/dark/galaxy.svg', '/badges/dark/galaxy.svg', '/badges/light/galaxy.svg', 250, true),
('bastion', '堡垒', 'Bastion', '堡垒 (Bastion)', 'aegis', 'core', '核心科幻', '/badges/dark/bastion.svg', '/badges/dark/bastion.svg', '/badges/light/bastion.svg', 260, true),
('phalanx', '方阵', 'Phalanx', '方阵 (Phalanx)', 'aegis', 'core', '核心科幻', '/badges/dark/phalanx.svg', '/badges/dark/phalanx.svg', '/badges/light/phalanx.svg', 270, true),
('sentinel', '哨兵', 'Sentinel', '哨兵 (Sentinel)', 'aegis', 'core', '核心科幻', '/badges/dark/sentinel.svg', '/badges/dark/sentinel.svg', '/badges/light/sentinel.svg', 280, true),
('fortress', '要塞', 'Fortress', '要塞 (Fortress)', 'aegis', 'core', '核心科幻', '/badges/dark/fortress.svg', '/badges/dark/fortress.svg', '/badges/light/fortress.svg', 290, true),
('guardian', '守护', 'Guardian', '守护 (Guardian)', 'aegis', 'core', '核心科幻', '/badges/dark/guardian.svg', '/badges/dark/guardian.svg', '/badges/light/guardian.svg', 300, true),
('citadel', '城塞', 'Citadel', '城塞 (Citadel)', 'aegis', 'core', '核心科幻', '/badges/dark/citadel.svg', '/badges/dark/citadel.svg', '/badges/light/citadel.svg', 310, true),
('paladin', '圣骑', 'Paladin', '圣骑 (Paladin)', 'aegis', 'core', '核心科幻', '/badges/dark/paladin.svg', '/badges/dark/paladin.svg', '/badges/light/paladin.svg', 320, true),
('barrier', '壁垒', 'Barrier', '壁垒 (Barrier)', 'aegis', 'core', '核心科幻', '/badges/dark/barrier.svg', '/badges/dark/barrier.svg', '/badges/light/barrier.svg', 330, true),
('ward', '结界', 'Ward', '结界 (Ward)', 'aegis', 'core', '核心科幻', '/badges/dark/ward.svg', '/badges/dark/ward.svg', '/badges/light/ward.svg', 340, true),
('defender', '卫士', 'Defender', '卫士 (Defender)', 'aegis', 'core', '核心科幻', '/badges/dark/defender.svg', '/badges/dark/defender.svg', '/badges/light/defender.svg', 350, true),
('fusion', '聚变', 'Fusion', '聚变 (Fusion)', 'reactor', 'core', '核心科幻', '/badges/dark/fusion.svg', '/badges/dark/fusion.svg', '/badges/light/fusion.svg', 360, true),
('plasma', '等离子', 'Plasma', '等离子 (Plasma)', 'reactor', 'core', '核心科幻', '/badges/dark/plasma.svg', '/badges/dark/plasma.svg', '/badges/light/plasma.svg', 370, true),
('pulse', '脉冲', 'Pulse', '脉冲 (Pulse)', 'reactor', 'core', '核心科幻', '/badges/dark/pulse.svg', '/badges/dark/pulse.svg', '/badges/light/pulse.svg', 380, true),
('ignition', '点火', 'Ignition', '点火 (Ignition)', 'reactor', 'core', '核心科幻', '/badges/dark/ignition.svg', '/badges/dark/ignition.svg', '/badges/light/ignition.svg', 390, true),
('core', '内核', 'Core', '内核 (Core)', 'reactor', 'core', '核心科幻', '/badges/dark/core.svg', '/badges/dark/core.svg', '/badges/light/core.svg', 400, true),
('fission', '裂变', 'Fission', '裂变 (Fission)', 'reactor', 'core', '核心科幻', '/badges/dark/fission.svg', '/badges/dark/fission.svg', '/badges/light/fission.svg', 410, true),
('overload', '过载', 'Overload', '过载 (Overload)', 'reactor', 'core', '核心科幻', '/badges/dark/overload.svg', '/badges/dark/overload.svg', '/badges/light/overload.svg', 420, true),
('dynamo', '动力', 'Dynamo', '动力 (Dynamo)', 'reactor', 'core', '核心科幻', '/badges/dark/dynamo.svg', '/badges/dark/dynamo.svg', '/badges/light/dynamo.svg', 430, true),
('radiance', '辐射', 'Radiance', '辐射 (Radiance)', 'reactor', 'core', '核心科幻', '/badges/dark/radiance.svg', '/badges/dark/radiance.svg', '/badges/light/radiance.svg', 440, true),
('vortex', '涡流', 'Vortex', '涡流 (Vortex)', 'reactor', 'core', '核心科幻', '/badges/dark/vortex.svg', '/badges/dark/vortex.svg', '/badges/light/vortex.svg', 450, true),
('sniper', '狙击', 'Sniper', '狙击 (Sniper)', 'tactical', 'core', '核心科幻', '/badges/dark/sniper.svg', '/badges/dark/sniper.svg', '/badges/light/sniper.svg', 460, true),
('lockon', '锁定', 'Lock-On', '锁定 (Lock-On)', 'tactical', 'core', '核心科幻', '/badges/dark/lockon.svg', '/badges/dark/lockon.svg', '/badges/light/lockon.svg', 470, true),
('radar', '雷达', 'Radar', '雷达 (Radar)', 'tactical', 'core', '核心科幻', '/badges/dark/radar.svg', '/badges/dark/radar.svg', '/badges/light/radar.svg', 480, true),
('strike', '打击', 'Strike', '打击 (Strike)', 'tactical', 'core', '核心科幻', '/badges/dark/strike.svg', '/badges/dark/strike.svg', '/badges/light/strike.svg', 490, true),
('recon', '侦察', 'Recon', '侦察 (Recon)', 'tactical', 'core', '核心科幻', '/badges/dark/recon.svg', '/badges/dark/recon.svg', '/badges/light/recon.svg', 500, true),
('crosshair', '准星', 'Crosshair', '准星 (Crosshair)', 'tactical', 'core', '核心科幻', '/badges/dark/crosshair.svg', '/badges/dark/crosshair.svg', '/badges/light/crosshair.svg', 510, true),
('tracer', '追踪', 'Tracer', '追踪 (Tracer)', 'tactical', 'core', '核心科幻', '/badges/dark/tracer.svg', '/badges/dark/tracer.svg', '/badges/light/tracer.svg', 520, true),
('overwatch', '天眼', 'Overwatch', '天眼 (Overwatch)', 'tactical', 'core', '核心科幻', '/badges/dark/overwatch.svg', '/badges/dark/overwatch.svg', '/badges/light/overwatch.svg', 530, true),
('intercept', '拦截', 'Intercept', '拦截 (Intercept)', 'tactical', 'core', '核心科幻', '/badges/dark/intercept.svg', '/badges/dark/intercept.svg', '/badges/light/intercept.svg', 540, true),
('barrage', '弹幕', 'Barrage', '弹幕 (Barrage)', 'tactical', 'core', '核心科幻', '/badges/dark/barrage.svg', '/badges/dark/barrage.svg', '/badges/light/barrage.svg', 550, true),
('oracle', '神谕', 'Oracle', '神谕 (Oracle)', 'arcane', 'core', '核心科幻', '/badges/dark/oracle.svg', '/badges/dark/oracle.svg', '/badges/light/oracle.svg', 560, true),
('mystic', '秘法', 'Mystic', '秘法 (Mystic)', 'arcane', 'core', '核心科幻', '/badges/dark/mystic.svg', '/badges/dark/mystic.svg', '/badges/light/mystic.svg', 570, true),
('rune', '符文', 'Rune', '符文 (Rune)', 'arcane', 'core', '核心科幻', '/badges/dark/rune.svg', '/badges/dark/rune.svg', '/badges/light/rune.svg', 580, true),
('glyph', '印记', 'Glyph', '印记 (Glyph)', 'arcane', 'core', '核心科幻', '/badges/dark/glyph.svg', '/badges/dark/glyph.svg', '/badges/light/glyph.svg', 590, true),
('aether', '以太', 'Aether', '以太 (Aether)', 'arcane', 'core', '核心科幻', '/badges/dark/aether.svg', '/badges/dark/aether.svg', '/badges/light/aether.svg', 600, true),
('sigil', '刻印', 'Sigil', '刻印 (Sigil)', 'arcane', 'core', '核心科幻', '/badges/dark/sigil.svg', '/badges/dark/sigil.svg', '/badges/light/sigil.svg', 610, true),
('astral', '星灵', 'Astral', '星灵 (Astral)', 'arcane', 'core', '核心科幻', '/badges/dark/astral.svg', '/badges/dark/astral.svg', '/badges/light/astral.svg', 620, true),
('abyss', '深渊', 'Abyss', '深渊 (Abyss)', 'arcane', 'core', '核心科幻', '/badges/dark/abyss.svg', '/badges/dark/abyss.svg', '/badges/light/abyss.svg', 630, true),
('paradox', '悖论', 'Paradox', '悖论 (Paradox)', 'arcane', 'core', '核心科幻', '/badges/dark/paradox.svg', '/badges/dark/paradox.svg', '/badges/light/paradox.svg', 640, true),
('enigma', '谜团', 'Enigma', '谜团 (Enigma)', 'arcane', 'core', '核心科幻', '/badges/dark/enigma.svg', '/badges/dark/enigma.svg', '/badges/light/enigma.svg', 650, true),
('rat', '子鼠', 'Water', '子鼠 (Water)', 'zodiac', 'astro-zodiac', '星相生肖', '/badges/dark/rat.svg', '/badges/dark/rat.svg', '/badges/light/rat.svg', 660, true),
('pig', '亥猪', 'Water', '亥猪 (Water)', 'zodiac', 'astro-zodiac', '星相生肖', '/badges/dark/pig.svg', '/badges/dark/pig.svg', '/badges/light/pig.svg', 670, true),
('tiger', '寅虎', 'Wood', '寅虎 (Wood)', 'zodiac', 'astro-zodiac', '星相生肖', '/badges/dark/tiger.svg', '/badges/dark/tiger.svg', '/badges/light/tiger.svg', 680, true),
('rabbit', '卯兔', 'Wood', '卯兔 (Wood)', 'zodiac', 'astro-zodiac', '星相生肖', '/badges/dark/rabbit.svg', '/badges/dark/rabbit.svg', '/badges/light/rabbit.svg', 690, true),
('snake', '巳蛇', 'Fire', '巳蛇 (Fire)', 'zodiac', 'astro-zodiac', '星相生肖', '/badges/dark/snake.svg', '/badges/dark/snake.svg', '/badges/light/snake.svg', 700, true),
('horse', '午马', 'Fire', '午马 (Fire)', 'zodiac', 'astro-zodiac', '星相生肖', '/badges/dark/horse.svg', '/badges/dark/horse.svg', '/badges/light/horse.svg', 710, true),
('monkey', '申猴', 'Metal', '申猴 (Metal)', 'zodiac', 'astro-zodiac', '星相生肖', '/badges/dark/monkey.svg', '/badges/dark/monkey.svg', '/badges/light/monkey.svg', 720, true),
('rooster', '酉鸡', 'Metal', '酉鸡 (Metal)', 'zodiac', 'astro-zodiac', '星相生肖', '/badges/dark/rooster.svg', '/badges/dark/rooster.svg', '/badges/light/rooster.svg', 730, true),
('ox', '丑牛', 'Earth', '丑牛 (Earth)', 'zodiac', 'astro-zodiac', '星相生肖', '/badges/dark/ox.svg', '/badges/dark/ox.svg', '/badges/light/ox.svg', 740, true),
('dragon', '辰龙', 'Earth', '辰龙 (Earth)', 'zodiac', 'astro-zodiac', '星相生肖', '/badges/dark/dragon.svg', '/badges/dark/dragon.svg', '/badges/light/dragon.svg', 750, true),
('goat', '未羊', 'Earth', '未羊 (Earth)', 'zodiac', 'astro-zodiac', '星相生肖', '/badges/dark/goat.svg', '/badges/dark/goat.svg', '/badges/light/goat.svg', 760, true),
('dog', '戌狗', 'Earth', '戌狗 (Earth)', 'zodiac', 'astro-zodiac', '星相生肖', '/badges/dark/dog.svg', '/badges/dark/dog.svg', '/badges/light/dog.svg', 770, true),
('aries', '白羊', 'Fire', '白羊 (Fire)', 'astral', 'astro-zodiac', '星相生肖', '/badges/dark/aries.svg', '/badges/dark/aries.svg', '/badges/light/aries.svg', 780, true),
('leo', '狮子', 'Fire', '狮子 (Fire)', 'astral', 'astro-zodiac', '星相生肖', '/badges/dark/leo.svg', '/badges/dark/leo.svg', '/badges/light/leo.svg', 790, true),
('sagittarius', '射手', 'Fire', '射手 (Fire)', 'astral', 'astro-zodiac', '星相生肖', '/badges/dark/sagittarius.svg', '/badges/dark/sagittarius.svg', '/badges/light/sagittarius.svg', 800, true),
('taurus', '金牛', 'Earth', '金牛 (Earth)', 'astral', 'astro-zodiac', '星相生肖', '/badges/dark/taurus.svg', '/badges/dark/taurus.svg', '/badges/light/taurus.svg', 810, true),
('virgo', '处女', 'Earth', '处女 (Earth)', 'astral', 'astro-zodiac', '星相生肖', '/badges/dark/virgo.svg', '/badges/dark/virgo.svg', '/badges/light/virgo.svg', 820, true),
('capricorn', '摩羯', 'Earth', '摩羯 (Earth)', 'astral', 'astro-zodiac', '星相生肖', '/badges/dark/capricorn.svg', '/badges/dark/capricorn.svg', '/badges/light/capricorn.svg', 830, true),
('gemini', '双子', 'Air', '双子 (Air)', 'astral', 'astro-zodiac', '星相生肖', '/badges/dark/gemini.svg', '/badges/dark/gemini.svg', '/badges/light/gemini.svg', 840, true),
('libra', '天秤', 'Air', '天秤 (Air)', 'astral', 'astro-zodiac', '星相生肖', '/badges/dark/libra.svg', '/badges/dark/libra.svg', '/badges/light/libra.svg', 850, true),
('aquarius', '水瓶', 'Air', '水瓶 (Air)', 'astral', 'astro-zodiac', '星相生肖', '/badges/dark/aquarius.svg', '/badges/dark/aquarius.svg', '/badges/light/aquarius.svg', 860, true),
('cancer', '巨蟹', 'Water', '巨蟹 (Water)', 'astral', 'astro-zodiac', '星相生肖', '/badges/dark/cancer.svg', '/badges/dark/cancer.svg', '/badges/light/cancer.svg', 870, true),
('scorpio', '天蝎', 'Water', '天蝎 (Water)', 'astral', 'astro-zodiac', '星相生肖', '/badges/dark/scorpio.svg', '/badges/dark/scorpio.svg', '/badges/light/scorpio.svg', 880, true),
('pisces', '双鱼', 'Water', '双鱼 (Water)', 'astral', 'astro-zodiac', '星相生肖', '/badges/dark/pisces.svg', '/badges/dark/pisces.svg', '/badges/light/pisces.svg', 890, true)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "system_configs" ("key", "value", "type", "label", "description", "created_at", "updated_at") VALUES
('badge_catalog_seeded', 'true', 'boolean', '徽章目录已初始化', '用于避免启动时重复导入默认徽章目录', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "value" = EXCLUDED."value",
  "type" = EXCLUDED."type",
  "label" = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "updated_at" = CURRENT_TIMESTAMP;
