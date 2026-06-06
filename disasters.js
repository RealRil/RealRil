(function(){
    const MOD_ID = "disasters";
    try { if (window.$wt && $wt.modsLoaded && $wt.modsLoaded.includes(MOD_ID)) return; } catch(e){}
    try { if (window.$wt && $wt.modsLoaded) $wt.modsLoaded.push(MOD_ID); } catch(e){}

    function safeLog(msg){
        try { if (typeof logMessage === "function") { logMessage(msg); return; } } catch(e){}
        try { if (window.$wt && $wt.notify) { $wt.notify(msg); return; } } catch(e){}
        console.log(msg);
    }
    function uid(pref){ return (pref||"id")+"_"+Math.floor(Math.random()*1e9).toString(36); }
    function choose(arr){ return (arr && arr.length) ? arr[Math.floor(Math.random()*arr.length)] : null; }
    function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
    function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

    function waitFor(predicate, cb, timeout=20000){
        const start = Date.now();
        (function tick(){
            try { if (predicate()) return cb(); } catch(e){}
            if (Date.now() - start > timeout) return;
            setTimeout(tick, 50);
        })();
    }

    function getAllTowns(){
        try {
            if (typeof regFilter === "function") {
                const t = regFilter("town", ()=>true);
                if (Array.isArray(t)) return t;
            }
        } catch(e){}
        if (window.regs && Array.isArray(window.regs.town)) return window.regs.town;
        if (window.towns && Array.isArray(towns)) return towns;
        if (window.planet && Array.isArray(planet.towns)) return planet.towns;
        return [];
    }

    const chunkAtFn = (typeof chunkAt === "function") ? chunkAt : ((cx,cy) => {
        if (!planet || !planet.chunks) return null;
        return planet.chunks[cx + "," + cy] || null;
    });

    const randomChunkFn = (typeof randomChunk === "function") ? randomChunk : ((pred) => {
        if (!planet || !planet.chunks) return null;
        const keys = Object.keys(planet.chunks);
        if (!keys.length) return null;
        for (let i=0;i<60;i++){
            const k = keys[Math.floor(Math.random()*keys.length)];
            const c = planet.chunks[k];
            if (!c) continue;
            try { if (pred && !pred(c)) continue; } catch(e){ continue; }
            if (typeof c.x === "number" && typeof c.y === "number") return c;
            if (typeof c.cx === "number" && typeof c.cy === "number") return Object.assign({x:c.cx, y:c.cy}, c);
            const parts = k.split(",");
            const px = Number(parts[0]), py = Number(parts[1]);
            if (!Number.isNaN(px) && !Number.isNaN(py)) return Object.assign({x:px, y:py}, c);
        }
        return null;
    });

    const circleChunksFn = (typeof circleChunks === "function") ? circleChunks : ((cx,cy,r)=>{
        const out=[];
        for (let dx=-r; dx<=r; dx++){
            for (let dy=-r; dy<=r; dy++){
                if (Math.abs(dx)+Math.abs(dy) <= r) out.push({x:cx+dx, y:cy+dy});
            }
        }
        return out;
    });

    function chunkKeyFromTown(t){
        if (!t) return null;
        if (typeof t.cx === "number" && typeof t.cy === "number") return t.cx + "," + t.cy;
        if (typeof t.x === "number" && typeof t.y === "number") {
            if (typeof coordsToChunk === "function") {
                try {
                    const v = coordsToChunk(t.x, t.y);
                    if (typeof v === "string") return v;
                    if (Array.isArray(v) && v.length >= 2) return v[0] + "," + v[1];
                    if (v && typeof v.x === "number" && typeof v.y === "number") return v.x + "," + v.y;
                } catch(e){}
            }
            const cs = Number(window.chunkSize || 16);
            return (Math.floor(t.x / cs)) + "," + (Math.floor(t.y / cs));
        }
        return null;
    }

    function townsInChunksList(chunksArray){
        const set = {};
        chunksArray.forEach(c=>{
            if (!c) return;
            if (Array.isArray(c)) set[c[0]+","+c[1]] = true;
            else if (c.x !== undefined && c.y !== undefined) set[c.x + "," + c.y] = true;
            else if (c[0] !== undefined && c[1] !== undefined) set[c[0] + "," + c[1]] = true;
        });
        const towns = getAllTowns();
        return towns.filter(t => {
            const k = chunkKeyFromTown(t);
            return k && set[k];
        });
    }

    function buildChunks(cx,cy,r){
        return circleChunksFn(cx,cy,r).map(c => [c.x,c.y]);
    }

    function hasHospital(town) {
        if (!town) return false;
        if (town.hospital) return true;
        if (town.projects && town.projects.hospital) return true;
        if (town.landmarks && town.landmarks.includes("Hospital")) return true;
        return false;
    }

    function dropFaith(town, amount) {
        if (town && typeof town.faith === "number") {
            town.faith = Math.max(0, town.faith - amount);
        }
    }

    function dropWealth(town, amount) {
        if (!town) return;
        if (typeof town.cash === "number") town.cash = Math.max(0, town.cash - amount);
        if (typeof town.privateWealth === "number") town.privateWealth = Math.max(0, town.privateWealth - amount);
    }

    function destroyLandmarks(chunks) {
        if (!planet || !Array.isArray(planet.landmarks)) return;
        const set = {};
        chunks.forEach(c => {
            if (Array.isArray(c)) set[c[0]+","+c[1]] = true;
        });
        planet.landmarks = planet.landmarks.filter(lm => {
            if (lm && typeof lm.x === "number" && typeof lm.y === "number") {
                const cs = Number(window.chunkSize || 16);
                const cx = Math.floor(lm.x / cs);
                const cy = Math.floor(lm.y / cs);
                if (set[cx+","+cy]) {
                    safeLog(`A landmark (${lm.name || lm.type}) was destroyed.`);
                    return false;
                }
            }
            return true;
        });
    }

    function applyTownDamage(tt, popScale, areaScale, faithDrop, wealthDrop) {
        let mitigation = hasHospital(tt) ? 0.5 : 1;
        let killCount = Math.max(1, Math.ceil((tt.pop||0) * popScale * mitigation));
        try {
            if (typeof happen === "function") happen("Death", {reg:"player",id:1}, tt, {count: killCount});
            else tt.pop = Math.max(0, (tt.pop||0) - killCount);
        } catch(e){
            tt.pop = Math.max(0, (tt.pop||0) - killCount);
        }
        shrinkTownAreaSafely(tt, areaScale);
        dropFaith(tt, faithDrop);
        dropWealth(tt, wealthDrop);
    }

    function markChunksRadioactiveSafely(chunks, days){
        try {
            for (let i=0;i<chunks.length;i++){
                const key = chunks[i][0] + "," + chunks[i][1];
                const ch = planet && planet.chunks ? planet.chunks[key] : null;
                if (ch) {
                    ch._radioactive = true;
                    if (ch._orig_b === undefined) ch._orig_b = ch.b;
                    ch._radio_days = Math.max(0, Math.floor(days || (ch._radio_days || 0)));
                    if (Array.isArray(ch.pixels)) ch.pixels.forEach(px => px._radioactive = true);
                }
            }
        } catch(e){}
    }

    function markAlienHole(chunks){
        try {
            for (let i=0;i<chunks.length;i++){
                const key = chunks[i][0] + "," + chunks[i][1];
                const ch = planet && planet.chunks ? planet.chunks[key] : null;
                if (ch) {
                    ch._alien_hole = true;
                    if (Array.isArray(ch.pixels)) ch.pixels.forEach(px => px._alien_hole = true);
                }
            }
        } catch(e){}
    }

    function shrinkTownAreaSafely(town, factor = 0.5) {
        if (!town) return;
        const props = ["area","size","radius","influence","reach","territory"];
        for (let i=0;i<props.length;i++){
            const p = props[i];
            if (typeof town[p] === "number") town[p] = Math.max(0, town[p] * factor);
        }
        town._areaScale = (town._areaScale || 1) * factor;
        town._areaShrunk = true;
    }

    function createProcessAndLog(opts){
        try {
            const created = happen("Create", null, null, {
                x: opts.x,
                y: opts.y,
                chunks: opts.chunks || [],
                type: "disaster",
                subtype: opts.subtype,
                duration: opts.duration || 1
            }, "process");
            if (!created) return null;

            if (Array.isArray(opts.chunks) && opts.chunks.length) {
                try { created.chunks = opts.chunks.slice(); } catch(e){}
            }

            if (Array.isArray(created.chunks)) {
                created.chunks = created.chunks.map(c => {
                    if (!c) return null;
                    if (Array.isArray(c)) return [Number(c[0]), Number(c[1])];
                    if (c.x !== undefined && c.y !== undefined) return [Number(c.x), Number(c.y)];
                    return null;
                }).filter(Boolean);
            }

            if (opts.name && !opts.noName) created.name = opts.name;
            if (opts.scale) created.scale = opts.scale;
            const modUid = uid("disaster");
            created._disaster_mod_uid = modUid;

            if (!created.locationDesc){
                let loc = null;
                if (opts.town){
                    try {
                        const all = getAllTowns();
                        const tt = all.find(x => x.id === opts.town);
                        if (tt) loc = tt.name || ("{{regname:town|" + tt.id + "}}");
                    } catch(e){}
                }
                if (!loc && Array.isArray(created.chunks) && created.chunks.length){
                    const towns = townsInChunksList(created.chunks);
                    if (towns && towns.length) loc = towns[0].name || ("{{regname:town|" + towns[0].id + "}}");
                }
                if (!loc){
                    if (Array.isArray(created.chunks) && created.chunks.length) loc = `(${created.chunks[0][0]},${created.chunks[0][1]})`;
                    else loc = "the land";
                }
                created.locationDesc = loc;
            }

            let msgMap = {
                volcano: `${created.name} erupts on ${created.locationDesc}.`,
                tornado: `${created.name} touches down on ${created.locationDesc}.(its so joever chat)`,
                tsunami: `${created.name} pounds the coast at ${created.locationDesc}.`,
                meteor: `${created.name} impacts near ${created.locationDesc}.`,
                solar_flare: `${created.name} streaks across the skies.`,
                sandstorm: `${created.name} scours ${created.locationDesc}.`,
                nuke: `${created.name} detonates near ${created.locationDesc}. A large area will be radioactive.`,
                alien_laser: `${created.name} blasts ${created.locationDesc}. A permanent hole remains.`,
                drought: `Drought affects ${created.locationDesc}.`,
                epidemic: `${created.name || "An epidemic"} begins at ${created.locationDesc}.`,
                avalanche: `An avalanche buries ${created.locationDesc}.`,
                acid_rain: `Acid rain falls over ${created.locationDesc}.`,
                magnetic_storm: `A magnetic storm disrupts ${created.locationDesc}.`,
                industrial_accident: `An industrial accident occurs at ${created.locationDesc}.`,
                locust_swarm: `A locust swarm descends upon ${created.locationDesc}.`,
                sinkhole: `A massive sinkhole opens at ${created.locationDesc}.`,
                hailstorm: `A violent hailstorm strikes ${created.locationDesc}.`,
                heatwave: `A severe heatwave bakes ${created.locationDesc}.`,
                flash_flood: `Flash floods wash through ${created.locationDesc}.`,
                deep_freeze: `A deep freeze halts life at ${created.locationDesc}.`,
                meteor_shower: `A meteor shower bombards ${created.locationDesc}.`
            };
            
            let message = msgMap[created.subtype || opts.subtype] || `${created.name || opts.subtype} occurs at ${created.locationDesc}.`;
            safeLog(message);

            if (opts.noName && created) created.name = "";
            return created;
        } catch (e){
            return null;
        }
    }

    window._disasterMovers = window._disasterMovers || {};

    function adjustTownFoodSafely(town, delta){
        if (!town) return false;
        const names = ["food","prod","production","yield","crops","harvest"];
        for (let i=0;i<names.length;i++){
            const n = names[i];
            if (typeof town[n] === "number"){
                town[n] = Math.max(0, Math.floor(town[n] + delta));
                return true;
            }
        }
        return false;
    }

    function evolveStormShape(proc){
        try {
            if (!proc || !Array.isArray(proc.chunks) || !proc.chunks.length) return;
            proc._shape_seed = proc._shape_seed || (Math.random() * 1000);
            const baseRadius = Math.max(1, Math.round(Math.sqrt(proc.chunks.length)));
            const radiusJitter = choose([-1,0,1]);
            const newRadius = clamp(baseRadius + radiusJitter, 1, baseRadius + 2);
            const current = proc.chunks[0];
            const cx = current ? current[0] + choose([-1,0,1]) : 0;
            const cy = current ? current[1] + choose([-1,0,1]) : 0;
            let candidate = buildChunks(cx, cy, newRadius);
            const keepFrac = 0.6;
            const old = proc.chunks.slice();
            const keepCount = Math.round(old.length * keepFrac);
            const kept = old.slice(0, keepCount);
            const maxTarget = Math.max(1, Math.round(old.length * 1.3));
            const merged = kept.concat(candidate).slice(0, maxTarget);
            const seen = {};
            const out = [];
            for (let i=0;i<merged.length;i++){
                const k = merged[i][0]+","+merged[i][1];
                if (!seen[k]) { seen[k]=true; out.push([merged[i][0], merged[i][1]]); }
            }
            if (out.length) proc.chunks = out;
        } catch(e){}
    }

    function buildSolarJaggedEnhanced(cx,cy,steps,patchRadius){
        const chunks = [];
        let x = cx, y = cy;
        const clusters = Math.max(1, Math.round(steps / (2 + patchRadius)));
        for (let c=0;c<clusters;c++){
            const clusterSteps = Math.max(3, Math.floor(steps / clusters) + randInt(-2,2));
            for (let i=0;i<clusterSteps;i++){
                const patch = circleChunksFn(x,y, patchRadius + randInt(0,2));
                for (let p=0;p<patch.length;p++) {
                    const jitterX = patch[p].x + randInt(-1,1);
                    const jitterY = patch[p].y + randInt(-1,1);
                    chunks.push([jitterX, jitterY]);
                }
                x += randInt(-patchRadius-2, patchRadius+2);
                y += randInt(-patchRadius-2, patchRadius+2);
                if (Math.random() < 0.18) {
                    x += randInt(-Math.max(6,steps/4), Math.max(6,steps/4));
                    y += randInt(-Math.max(6,steps/4), Math.max(6,steps/4));
                }
                if (window.planet && typeof planet.width === "number" && typeof planet.height === "number"){
                    x = clamp(x, 0, Math.max(0, Math.floor(planet.width/(window.chunkSize||16))-1));
                    y = clamp(y, 0, Math.max(0, Math.floor(planet.height/(window.chunkSize||16))-1));
                }
            }
            x = cx + randInt(-Math.max(1,clusters), Math.max(1,clusters));
            y = cy + randInt(-Math.max(1,clusters), Math.max(1,clusters));
        }
        const set = {}; const out = [];
        for (let i=0;i<chunks.length;i++){ const k = chunks[i][0]+","+chunks[i][1]; if (!set[k]) { set[k]=true; out.push(chunks[i]); } }
        return out;
    }

    function showEpidemicChoiceOnce(proc){
        try {
            if (!proc) return;
            window.NaturalDisasters = window.NaturalDisasters || {};
            if (window.NaturalDisasters._epidemicChoiceShown) return;
            const towns = townsInChunksList(proc.chunks || []);
            if (!towns || towns.length < 3) return;

            let title = "Epidemic Research";
            let body = `A large epidemic has begun in ${proc.locationDesc}. Research for a cure now? Choosing YES will help scientists shorten the outbreak to 1-2 days remaining. Choosing NO will let it run longer (and may spread). This choice appears only once.`;
            let confirmed = null;

            try {
                if (window.$wt && $wt.confirm) {
                    confirmed = $wt.confirm(title + "\n\n" + body);
                } else if (typeof window.confirm === "function") {
                    confirmed = window.confirm(title + "\n\n" + body);
                } else {
                    safeLog(title + ": " + body);
                    confirmed = false;
                }
            } catch(e){
                try { confirmed = window.confirm(title + "\n\n" + body); } catch(e){ confirmed = false; }
            }

            window.NaturalDisasters._epidemicChoiceShown = true;
            proc._epidemic_choice_shown = true;

            if (confirmed) {
                const days = randInt(1,2);
                proc._epidemic_days = days;
                const affected = townsInChunksList(proc.chunks || []);
                affected.forEach(tt => {
                    tt._epidemic_days = Math.min(tt._epidemic_days || days, days);
                    if(hasHospital(tt)) tt._epidemic_days = 0;
                });
                safeLog("Research teams accelerated a cure. The epidemic will wind down quickly.");
                affected.forEach(tt => dropFaith(tt, -5)); 
            } else {
                const extra = randInt(8,16);
                proc._epidemic_days = (proc._epidemic_days || 0) + extra;
                const affected = townsInChunksList(proc.chunks || []);
                affected.forEach(tt => {
                    let mitigation = hasHospital(tt) ? 0.5 : 1;
                    tt._epidemic_days = Math.max(tt._epidemic_days || 0, (tt._epidemic_days || 0) + Math.floor(extra * mitigation));
                });
                safeLog("Research delayed. The epidemic will last significantly longer.");
                affected.forEach(tt => dropFaith(tt, 10)); 
            }
        } catch(e){}
    }

    (function ensureMoverTick(){
        const tickId = "Disasters_mover_daily";
        if (window.__disasters_mover_registered) return;
        Mod.event(tickId, {
            daily: true,
            subject: { reg: "player", id: 1 },
            func: (subject, target, args) => {
                try {
                    const procs = (typeof regFilter === "function") ? regFilter("process", p => p && p.type === "disaster") : (planet && planet.processes ? planet.processes.filter(p => p && p.type === "disaster") : []);
                    if (!procs || !procs.length) { cleanupChunkTimers(); return; }

                    const moverKeys = Object.keys(window._disasterMovers || {});
                    moverKeys.forEach(k => {
                        const m = window._disasterMovers[k];
                        if (!m) return;
                        const proc = procs.find(p => p && p._disaster_mod_uid === k);
                        if (!proc) { delete window._disasterMovers[k]; return; }
                        if (proc.done) { delete window._disasterMovers[k]; return; }

                        if (["thunderstorm", "blizzard", "sandstorm", "locust_swarm"].includes(m.subtype)) {
                            evolveStormShape(proc);
                        }

                        if (["thunderstorm", "blizzard", "sandstorm", "tornado", "locust_swarm"].includes(m.subtype)) {
                            const current = Array.isArray(proc.chunks) && proc.chunks.length ? proc.chunks[0] : null;
                            if (!current) return;
                            let cx = current[0], cy = current[1];

                            if (typeof m.vx !== "number" || typeof m.vy !== "number") {
                                m.vx = choose([-1,0,1]) * 0.6;
                                m.vy = choose([-1,0,1]) * 0.6;
                            }
                            m.vx += (Math.random() - 0.5) * 0.4;
                            m.vy += (Math.random() - 0.5) * 0.4;
                            m.vx = clamp(m.vx, -1.5, 1.5);
                            m.vy = clamp(m.vy, -1.5, 1.5);

                            const nx = Math.round(cx + m.vx);
                            const ny = Math.round(cy + m.vy);

                            const baseRadius = Math.max(1, Math.round((proc.chunks && proc.chunks.length) ? Math.sqrt(proc.chunks.length) : 2));
                            const radius = clamp(baseRadius + Math.round(Math.sin(Date.now()/60000 + (m.vx+m.vy))*1), 1, baseRadius+2);

                            let newChunks = buildChunks(nx, ny, radius);
                            if (m.subtype === "sandstorm") {
                                const filtered = newChunks.filter(cc => {
                                    const ch = chunkAtFn(cc[0], cc[1]);
                                    return ch && ch.b && String(ch.b).toLowerCase().includes("desert");
                                });
                                if (filtered.length) newChunks = filtered;
                                else newChunks = proc.chunks.slice();
                            }
                            proc.chunks = newChunks.length ? newChunks : proc.chunks;

                            const towns = townsInChunksList(proc.chunks);
                            if (towns && towns.length) proc.locationDesc = towns[0].name || proc.locationDesc;

                            if (m.subtype === "thunderstorm" || m.subtype === "blizzard") {
                                applyStormMoistureEffect(proc);
                            }
                        }
                    });

                    procs.forEach(proc => {
                        try { dailyProcessEffects(proc); } catch(e){}
                    });

                    cleanupChunkTimers();

                } catch (e){}
            }
        });
        window.__disasters_mover_registered = true;
    })();

    function applyStormMoistureEffect(proc){
        if (!proc || !Array.isArray(proc.chunks)) return;
        const towns = townsInChunksList(proc.chunks);
        towns.forEach(tt => {
            try {
                tt._recent_rain_days = (tt._recent_rain_days || 0) + 1;
                if (adjustTownFoodSafely(tt, 1)) {
                    tt._crop_boost_applied = (tt._crop_boost_applied || 0) + 1;
                } else {
                    if ((tt._recent_rain_days || 0) >= 3 && Math.random() < 0.12) {
                        if (typeof tt.pop === "number") tt.pop = Math.max(1, Math.floor(tt.pop + 0.01 * Math.max(1, tt.pop)));
                    }
                }
            } catch(e){}
        });
    }

    function dailyProcessEffects(proc){
        if (!proc || !proc.subtype) return;

        if (proc.subtype === "nuke") {
            if (!proc._radiation_initialized) {
                const radDays = randInt(20,30);
                proc._radiation_days = radDays;
                if (Array.isArray(proc.chunks) && proc.chunks.length) {
                    markChunksRadioactiveSafely(proc.chunks, radDays);
                }
                const affected = townsInChunksList(proc.chunks || []);
                affected.forEach(tt => {
                    let mitigation = hasHospital(tt) ? 0.3 : 1;
                    tt._radiation_sick_days = Math.max(tt._radiation_sick_days || 0, Math.floor(randInt(20,30) * mitigation));
                    if (Math.random() < 0.25 * mitigation) {
                        applyTownDamage(tt, 0.05, 0.9, 1, 0);
                    }
                });
                proc._radiation_initialized = true;
            }
            if (typeof proc._radiation_days === "number") proc._radiation_days = Math.max(0, proc._radiation_days - 1);
            const affected = townsInChunksList(proc.chunks || []);
            affected.forEach(tt => {
                let mitigation = hasHospital(tt) ? 0.3 : 1;
                if (tt._radiation_sick_days && tt._radiation_sick_days > 0) {
                    if (Math.random() < 0.12 * mitigation) {
                        applyTownDamage(tt, 0.01, 1, 0, 0);
                    }
                    tt._radiation_sick_days = Math.max(0, tt._radiation_sick_days - 1);
                }
            });
            if (proc._radiation_days === 0) proc._radiation_finished = true;
            return;
        }

        if (proc.subtype === "solar_flare") {
            if (!proc._solar_initialized) {
                const solarDays = clamp(proc.duration || randInt(30, 120), 20, 240);
                proc._solar_days = solarDays;
                if (Array.isArray(proc.chunks) && proc.chunks.length <= 1) {
                    const base = proc.chunks[0] || [proc.x, proc.y];
                    proc.chunks = buildSolarJaggedEnhanced(base[0], base[1], randInt(60, 140), randInt(1, 3));
                }
                proc.chunks.forEach(c => {
                    const key = c[0] + "," + c[1];
                    const ch = planet && planet.chunks ? planet.chunks[key] : null;
                    if (ch) {
                        ch._solar_days = Math.max(ch._solar_days || 0, solarDays);
                        ch._solar_affected = true;
                    }
                });
                proc._solar_initialized = true;
            }

            if (typeof proc._solar_days === "number") proc._solar_days = Math.max(0, proc._solar_days - 1);
            const affected = townsInChunksList(proc.chunks || []);
            affected.forEach(tt => {
                const severity = Math.min(0.5, 0.12 + Math.random() * 0.28);
                if (Math.random() < severity) adjustTownFoodSafely(tt, -1);
                const ck = chunkKeyFromTown(tt);
                if (ck) {
                    const ch = planet && planet.chunks ? planet.chunks[ck] : null;
                    if (ch) ch._solar_affected = true;
                }
            });
            if (proc._solar_days === 0) proc._solar_finished = true;
            return;
        }

        if (proc.subtype === "drought") {
            if (!proc._drought_initialized) {
                const days = clamp(proc.duration || randInt(4,8), 4, 12);
                proc._drought_days = days;
                if (Array.isArray(proc.chunks)) {
                    proc.chunks.forEach(c => {
                        const key = c[0]+","+c[1];
                        const ch = planet && planet.chunks ? planet.chunks[key] : null;
                        if (ch) {
                            ch._drought_days = Math.max(ch._drought_days || 0, days);
                            ch._drought = true;
                        }
                    });
                }
                proc._drought_initialized = true;
                proc._drought_shrink_rate = 0.06; 
            }

            if (typeof proc._drought_days === "number") proc._drought_days = Math.max(0, proc._drought_days - 1);

            const affected = townsInChunksList(proc.chunks || []);
            affected.forEach(tt => {
                adjustTownFoodSafely(tt, -randInt(1,3));
                tt._drought_days = Math.max(0, (tt._drought_days || 0) - 1);
                if (Math.random() < 0.1) {
                    dropWealth(tt, 1);
                }
            });

            if (Array.isArray(proc.chunks) && proc.chunks.length > 1) {
                const removeCount = Math.max(1, Math.floor(proc.chunks.length * (proc._drought_shrink_rate || 0.05)));
                for (let r=0; r<removeCount; r++){
                    const idx = Math.floor(Math.random() * proc.chunks.length);
                    const removed = proc.chunks.splice(idx, 1);
                    try {
                        if (removed && removed[0]) {
                            const key = removed[0][0] + "," + removed[0][1];
                            const ch = planet && planet.chunks ? planet.chunks[key] : null;
                            if (ch && ch._drought_days) ch._drought_days = Math.max(0, ch._drought_days - 1);
                        }
                    } catch(e){}
                }
            }

            if (proc._drought_days === 0 && !proc._drought_message_shown) {
                try { safeLog(`Drought at ${proc.locationDesc} has ended.`); } catch(e){}
                proc._drought_message_shown = true;
            }

            if (proc._drought_days === 0) proc._drought_finished = true;
            return;
        }

        if (proc.subtype === "epidemic") {
            if (!proc._epidemic_initialized) {
                proc._epidemic_days = clamp(proc.duration || randInt(8,16), 6, 30);
                proc._epidemic_infected = proc._epidemic_infected || 1;
                if (proc._initial_town) {
                    const all = getAllTowns();
                    const t = all.find(x => x.id === proc._initial_town);
                    if (t) {
                        t._epidemic_infected = Math.max(1, t._epidemic_infected || 0) + 1;
                        t._epidemic_days = proc._epidemic_days;
                    }
                }
                proc._epidemic_initialized = true;
            }

            if (!proc._pandemic_announced) {
                const towns = townsInChunksList(proc.chunks || []);
                if (towns.length >= 3) {
                    proc._isPandemic = true;
                    proc._pandemic_announced = true;
                    safeLog(`Pandemic detected: ${proc.name || "Epidemic"} affecting ${towns.length} towns near ${proc.locationDesc}.`);
                    try {
                        if (Array.isArray(proc.chunks)) {
                            proc.chunks.forEach(c => {
                                const key = c[0] + "," + c[1];
                                const ch = planet && planet.chunks ? planet.chunks[key] : null;
                                if (ch) ch._pandemic = true;
                            });
                        }
                        if (window.$wt && $wt.map && typeof $wt.map.addMarker === "function" && Array.isArray(proc.chunks)) {
                            const label = proc.name || "Pandemic";
                            proc._map_marker_ids = proc._map_marker_ids || [];
                            proc.chunks.forEach(c => {
                                try {
                                    const id = $wt.map.addMarker({x:c[0], y:c[1], label: label, type: "pandemic"});
                                    if (id) proc._map_marker_ids.push(id);
                                } catch(e){}
                            });
                        }
                    } catch(e){}
                }
            }

            if (typeof proc._epidemic_days === "number") proc._epidemic_days = Math.max(0, proc._epidemic_days - 1);

            const infectedTowns = getAllTowns().filter(tt => tt._epidemic_days && tt._epidemic_days > 0 && (tt._epidemic_infected && tt._epidemic_infected>0));
            infectedTowns.forEach(tt => {
                const inf = Math.max(1, tt._epidemic_infected || 1);
                let mitigation = hasHospital(tt) ? 0.3 : 1;
                if (Math.random() < 0.14 * mitigation) {
                    const deaths = Math.floor(Math.random() * Math.min(2, Math.max(1, Math.floor(inf/3))));
                    if (deaths > 0) {
                        applyTownDamage(tt, 0.01, 1, 1, 0);
                    }
                }
                tt._epidemic_days = Math.max(0, tt._epidemic_days - 1);

                try {
                    const ck = chunkKeyFromTown(tt);
                    if (!ck) return;
                    const [cx,cy] = ck.split(",").map(Number);
                    const neighChunks = circleChunksFn(cx,cy,2);
                    const possibleTowns = townsInChunksList(neighChunks.map(c=>[c.x,c.y]));
                    possibleTowns.forEach(dest => {
                        if (dest === tt) return;
                        if (Math.random() < 0.06 + Math.min(0.25, inf * 0.02)) {
                            dest._epidemic_infected = Math.max(1, dest._epidemic_infected || 0) + 1;
                            dest._epidemic_days = Math.max(dest._epidemic_days || 0, randInt(6,12));
                        }
                    });
                } catch(e){}
            });

            if (proc._epidemic_days === 0 && !proc._epidemic_message_shown) {
                safeLog(`${proc.name || "Epidemic"} at ${proc.locationDesc} has cleared.`);
                try {
                    if (Array.isArray(proc.chunks)) {
                        proc.chunks.forEach(c => {
                            const key = c[0] + "," + c[1];
                            const ch = planet && planet.chunks ? planet.chunks[key] : null;
                            if (ch) { if (ch._pandemic) delete ch._pandemic; }
                        });
                    }
                    if (proc._map_marker_ids && window.$wt && $wt.map && typeof $wt.map.removeMarker === "function") {
                        proc._map_marker_ids.forEach(id => {
                            try { $wt.map.removeMarker(id); } catch(e){}
                        });
                    }
                } catch(e){}
                const all = getAllTowns();
                all.forEach(tt => {
                    if (tt._epidemic_days && tt._epidemic_days <= 0) {
                        delete tt._epidemic_infected;
                        delete tt._epidemic_days;
                        delete tt._epidemic_origin_animal;
                    }
                });
                proc._epidemic_message_shown = true;
            }

            if (proc._epidemic_days === 0) proc._epidemic_finished = true;
            return;
        }

        if (proc.subtype === "acid_rain") {
            const affected = townsInChunksList(proc.chunks || []);
            affected.forEach(tt => {
                adjustTownFoodSafely(tt, -2);
                dropFaith(tt, 1);
            });
        }
        
        if (proc.subtype === "magnetic_storm") {
            const affected = townsInChunksList(proc.chunks || []);
            affected.forEach(tt => {
                dropWealth(tt, 5);
            });
        }
        
        if (proc.subtype === "locust_swarm") {
            const affected = townsInChunksList(proc.chunks || []);
            affected.forEach(tt => {
                adjustTownFoodSafely(tt, -10);
            });
        }
        
        if (proc.subtype === "heatwave") {
            const affected = townsInChunksList(proc.chunks || []);
            affected.forEach(tt => {
                adjustTownFoodSafely(tt, -1);
                if (Math.random() < 0.05) {
                    happen("Create", null, null, {x: tt.x, y: tt.y, type:"disaster", subtype:"wildfire", duration: 2}, "process");
                }
            });
        }
        
        if (proc.subtype === "deep_freeze") {
            const affected = townsInChunksList(proc.chunks || []);
            affected.forEach(tt => {
                adjustTownFoodSafely(tt, -5);
                dropWealth(tt, 2);
            });
        }
    }

    function cleanupChunkTimers(){
        try {
            if (!planet || !planet.chunks) return;
            Object.keys(planet.chunks).forEach(k => {
                const ch = planet.chunks[k];
                if (!ch) return;
                if (typeof ch._radio_days === "number" && ch._radio_days > 0) {
                    ch._radio_days = Math.max(0, ch._radio_days - 1);
                    if (ch._radio_days === 0) {
                        ch._radioactive = false;
                        if (ch._orig_b !== undefined) { ch.b = ch._orig_b; delete ch._orig_b; }
                        if (Array.isArray(ch.pixels)) ch.pixels.forEach(px => { if (px._radioactive) delete px._radioactive; });
                    }
                }
                if (typeof ch._solar_days === "number" && ch._solar_days > 0) {
                    ch._solar_days = Math.max(0, ch._solar_days - 1);
                    if (ch._solar_days === 0) {
                        if (ch._solar_affected) delete ch._solar_affected;
                        if (Array.isArray(ch.pixels)) ch.pixels.forEach(px => { if (px._solar_affected) delete px._solar_affected; });
                    }
                }
                if (typeof ch._drought_days === "number" && ch._drought_days > 0) {
                    ch._drought_days = Math.max(0, ch._drought_days - 1);
                    if (ch._drought_days === 0) {
                        if (ch._drought) delete ch._drought;
                        if (Array.isArray(ch.pixels)) ch.pixels.forEach(px => { if (px._drought) delete px._drought; });
                    }
                }
            });
        } catch(e){}
    }

    function findCoastalTownChunk(){
        const towns = getAllTowns();
        for (let i=0;i<towns.length;i++){
            const t = towns[i];
            const k = chunkKeyFromTown(t);
            if (!k) continue;
            const [cx,cy] = k.split(",").map(Number);
            const neigh = circleChunksFn(cx,cy,2);
            for (let j=0;j<neigh.length;j++){
                const c = chunkAtFn(neigh[j].x, neigh[j].y);
                if (c && c.b && String(c.b).toLowerCase().includes("water")) return {town: t, cx, cy};
            }
        }
        const c = randomChunkFn(c => c && c.b && String(c.b).toLowerCase().includes("water"));
        if (c) return {town:null, cx:c.x, cy:c.y};
        return null;
    }

    function findMountainTownChunk(){
        const towns = getAllTowns();
        for (let i=0;i<towns.length;i++){
            const t = towns[i];
            const k = chunkKeyFromTown(t);
            if (!k) continue;
            const [cx,cy] = k.split(",").map(Number);
            const ch = chunkAtFn(cx,cy);
            if (ch && ch.b && String(ch.b).toLowerCase().includes("mount")) return {town: t, cx, cy};
        }
        const c = randomChunkFn(c => c && c.b && String(c.b).toLowerCase().includes("mount"));
        if (c) return {town:null, cx:c.x, cy:c.y};
        return null;
    }

    function findDesertChunk(){
        const towns = getAllTowns();
        for (let i=0;i<towns.length;i++){
            const t = towns[i];
            const k = chunkKeyFromTown(t);
            if (!k) continue;
            const [cx,cy] = k.split(",").map(Number);
            const ch = chunkAtFn(cx,cy);
            if (ch && ch.b && String(ch.b).toLowerCase().includes("desert")) return {town: t, cx, cy};
        }
        const c = randomChunkFn(c => c && c.b && String(c.b).toLowerCase().includes("desert"));
        if (c) return {town:null, cx:c.x, cy:c.y};
        return null;
    }

    function findSnowMountainChunk(){
        const towns = getAllTowns();
        for (let i=0;i<towns.length;i++){
            const t = towns[i];
            const k = chunkKeyFromTown(t);
            if (!k) continue;
            const [cx,cy] = k.split(",").map(Number);
            const ch = chunkAtFn(cx,cy);
            const biome = ch && ch.b ? String(ch.b).toLowerCase() : (t && t.biome ? String(t.biome).toLowerCase() : "");
            if ((biome && biome.includes("snow")) || (ch && ch.b && String(ch.b).toLowerCase().includes("mount"))) return {town: t, cx, cy};
        }
        const c = randomChunkFn(c => {
            const b = c && c.b ? String(c.b).toLowerCase() : "";
            return b && (b.includes("snow") || b.includes("mount"));
        });
        if (c) return {town:null, cx:c.x, cy:c.y};
        return null;
    }

    function buildCoastalStrip(cx,cy,length){
        const strip = [];
        const neighborhood = circleChunksFn(cx,cy,4);
        const candidates = [];
        for (let i=0;i<neighborhood.length;i++){
            const c = neighborhood[i];
            const ch = chunkAtFn(c.x,c.y);
            if (!ch) continue;
            const isLand = !(ch.b && String(ch.b).toLowerCase().includes("water"));
            if (!isLand) continue;
            const neigh = circleChunksFn(c.x,c.y,1);
            let bordersWater = false;
            for (let j=0;j<neigh.length;j++){
                const n = chunkAtFn(neigh[j].x, neigh[j].y);
                if (n && n.b && String(n.b).toLowerCase().includes("water")) { bordersWater = true; break; }
            }
            if (bordersWater) candidates.push({x:c.x,y:c.y});
        }
        if (!candidates.length) return buildChunks(cx,cy,2);
        let current = choose(candidates);
        strip.push([current.x,current.y]);
        const used = {}; used[current.x+","+current.y] = true;
        for (let s=1; s<length; s++){
            const neigh = candidates.filter(c => !used[c.x+","+c.y] && Math.abs(c.x - current.x) + Math.abs(c.y - current.y) <= 2);
            if (!neigh.length) break;
            current = choose(neigh);
            strip.push([current.x,current.y]);
            used[current.x+","+current.y] = true;
        }
        if (strip.length < length){
            const remaining = candidates.filter(c => !used[c.x+","+c.y]);
            while (strip.length < length && remaining.length){
                const v = remaining.shift();
                strip.push([v.x,v.y]);
            }
        }
        return strip;
    }

    function buildSolarJagged(cx,cy,steps,patchRadius){
        const s = Math.max(20, steps || randInt(20,80));
        const pr = Math.max(1, patchRadius || randInt(1,4));
        return buildSolarJaggedEnhanced(cx,cy,s,pr);
    }

    function natName(prefix){
        const picks = ["Ibert","Alder","Kess","Voss","Anode","Rhett","Marun","Solen","Zahir","Galen","Vesta","Rook","Iona","Iver","Bryn","Ilya"];
        return (prefix||"") + " " + choose(picks);
    }

    waitFor(() => (window.actionables && actionables.process && actionables.process._disasterSubtypes !== undefined), () => {
        try {
            const sub = actionables.process._disasterSubtypes;

            sub["tornado"] = Object.assign(sub["tornado"] || {}, {
                location: "land", radius: 16, message: "[NAME] touches down $. (u cooked sonion)", messageDone: "[NAME] $ dissipates.", color: [200,140,30],
                name: (d) => { try { if (d && d.scale) return `${d.name || "Tornado"} (${d.scale})`; } catch(e){} return d && d.name ? d.name : "Tornado"; },
                deathRate: 10, destroy: true, spread: 3, duration: 25, scale: ["EF0","EF1","EF2","EF3","EF4","EF5"]
            });
            sub["thunderstorm"] = Object.assign(sub["thunderstorm"] || {}, {
                location: "any", radius: 4, message: "[NAME] batters $.", messageDone: "[NAME] $ wanes.", color: [90,110,210],
                name: (d) => { try { const c = chunkAtFn(d.x,d.y); const biome = c && c.b ? String(c.b).toLowerCase() : ""; if (biome.includes("snow")) return "Blizzard " + natName(""); } catch(e){} return "Thunderstorm " + natName(""); },
                deathRate: 4, destroy: true, spread: 3, duration: 10
            });
            sub["drought"] = Object.assign(sub["drought"] || {}, {
                location: "any", radius: 12, message: "[NAME] dries out $.", messageDone: "[NAME] $ breaks with rain.", color: [200,170,90],
                name: (d) => d && d.name ? d.name : natName("Drought"), deathRate: 1, destroy: true, spread: 2, duration: 32
            });
            sub["epidemic"] = Object.assign(sub["epidemic"] || {}, {
                location: "town", radius: 2, message: "[NAME] begins at $. (covid time gng)", messageDone: "[NAME] $ eases.", color: [180,50,50],
                name: (d) => d && d.name ? d.name : "Epidemic", deathRate: 7, destroy: false, spread: 10, duration: 20
            });
            sub["tsunami"] = Object.assign(sub["tsunami"] || {}, {
                location: "shore", radius: 8, message: "[NAME] pounds the coast $.", messageDone: "[NAME] $ recedes.", color: [20,100,200],
                name: (d) => "Tsunami", deathRate: 2, destroy: true, spread: 4, duration: 14
            });
            sub["sandstorm"] = Object.assign(sub["sandstorm"] || {}, {
                location: "desert", radius: 6, message: "[NAME] scours $.", messageDone: "[NAME] $ settles.", color: [210,170,70],
                name: (d) => d && d.name ? d.name : natName("Sandstorm"), deathRate: 0.5, destroy: false, spread: 2, duration: 12
            });
            sub["volcano"] = Object.assign(sub["volcano"] || {}, {
                location: "mountain", radius: 6, scale: ["1","2","3","4","5","6","7","8","9","10"], message: "[NAME] erupts $.", messageDone: "[NAME] $ quiets.", color: [200,90,20],
                name: (d) => d && d.name ? d.name : natName("Mount"), deathRate: 16, destroy: true, spread: 1, duration: 2
            });
            sub["meteor"] = Object.assign(sub["meteor"] || {}, {
                location: "any", radius: 4, message: "[NAME] impacts $.", messageDone: "[NAME] $ scorches the land.", color: [180,80,40],
                name: (d) => d && d.name ? d.name : natName("Meteor"), deathRate: 1.5, destroy: true, duration: 1
            });
            sub["solar_flare"] = Object.assign(sub["solar_flare"] || {}, {
                location: "any", radius: 0, message: "[NAME] washes the world $. (bye bye electronics)", messageDone: "[NAME] $ fades.", color: [255,220,120],
                name: (d) => "Solar Flare", deathRate: 0.33, destroy: false, spread: 0, duration: 62
            });
            sub["nuke"] = Object.assign(sub["nuke"] || {}, {
                location: "any", radius: 12, message: "[NAME] detonates $. (hope he used create mod for ts)", messageDone: "[NAME] $ ends — area remains contaminated.", color: [80,200,50],
                name: (d) => d && d.name ? d.name : "Nuclear Detonation", deathRate: 20.0, destroy: true, duration: 100
            });
            sub["avalanche"] = Object.assign(sub["avalanche"] || {}, {
                location: "mountain", radius: 2, message: "[NAME] buries $. (avrg day in canada)", messageDone: "[NAME] $ settles.", color: [180,210,230],
                name: (d) => d && d.name ? d.name : natName("Avalanche"), deathRate: 6, destroy: true, spread: 0, duration: 2
            });
            sub["alien_laser"] = Object.assign(sub["alien_laser"] || {}, {
                location: "any", radius: 2, message: "[NAME] blasts $.", messageDone: "[NAME] $ leaves a permanent void.", color: [150,20,200],
                name: (d) => d && d.name ? d.name : natName("Alien Strike"), deathRate: 5.0, destroy: true, duration: 1
            });

            sub["acid_rain"] = Object.assign(sub["acid_rain"] || {}, {
                location: "any", radius: 4, message: "[NAME] falls over $.", messageDone: "[NAME] $ ceases.", color: [160,220,130],
                name: (d) => "Acid Rain", deathRate: 0.05, destroy: false, duration: 4
            });
            sub["magnetic_storm"] = Object.assign(sub["magnetic_storm"] || {}, {
                location: "any", radius: 0, message: "[NAME] disrupts $.", messageDone: "[NAME] $ passes.", color: [120,120,255],
                name: (d) => "Magnetic Storm", deathRate: 0.01, destroy: false, duration: 6
            });
            sub["industrial_accident"] = Object.assign(sub["industrial_accident"] || {}, {
                location: "town", radius: 1, message: "[NAME] occurs at $.", messageDone: "[NAME] $ is contained.", color: [100,255,100],
                name: (d) => "Industrial Accident", deathRate: 3, destroy: true, duration: 2
            });
            sub["locust_swarm"] = Object.assign(sub["locust_swarm"] || {}, {
                location: "any", radius: 2, message: "[NAME] descends upon $.", messageDone: "[NAME] $ moves on.", color: [150,180,80],
                name: (d) => "Locust Swarm", deathRate: 0.1, destroy: false, duration: 5
            });
            sub["sinkhole"] = Object.assign(sub["sinkhole"] || {}, {
                location: "land", radius: 1, message: "[NAME] opens at $.", messageDone: "[NAME] $ stabilizes.", color: [80,60,40],
                name: (d) => "Massive Sinkhole", deathRate: 2.0, destroy: true, duration: 1
            });
            sub["hailstorm"] = Object.assign(sub["hailstorm"] || {}, {
                location: "any", radius: 2, message: "[NAME] strikes $.", messageDone: "[NAME] $ melts away.", color: [220,240,255],
                name: (d) => "Violent Hailstorm", deathRate: 11, destroy: true, duration: 7
            });
            sub["heatwave"] = Object.assign(sub["heatwave"] || {}, {
                location: "land", radius: 5, message: "[NAME] bakes $.", messageDone: "[NAME] $ breaks.", color: [255,100,50],
                name: (d) => "Severe Heatwave", deathRate: 4, destroy: false, duration: 14
            });
            sub["flash_flood"] = Object.assign(sub["flash_flood"] || {}, {
                location: "shore", radius: 2, message: "[NAME] washes through $.", messageDone: "[NAME] $ recedes.", color: [50,150,220],
                name: (d) => "Flash Flood", deathRate: 12, destroy: true, duration: 1
            });
            sub["deep_freeze"] = Object.assign(sub["deep_freeze"] || {}, {
                location: "any", radius: 5, message: "[NAME] halts life at $.", messageDone: "[NAME] $ thaws.", color: [180,220,255],
                name: (d) => "Deep Freeze", deathRate: 6, destroy: false, duration: 14
            });
            sub["meteor_shower"] = Object.assign(sub["meteor_shower"] || {}, {
                location: "any", radius: 4, message: "[NAME] bombards $.", messageDone: "[NAME] $ ends.", color: [255,180,100],
                name: (d) => "Meteor Shower", deathRate: 1.0, destroy: true, duration: 1
            });

        } catch (e){}

        Mod.event("dis_spawn_volcano", { random:true, weight:0.7, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.60) return;
                const found = findMountainTownChunk(); if (!found) return;
                const cx = found.cx, cy = found.cy;
                let mountName = null;
                if (found.town && found.town.name) mountName = found.town.name;
                else {
                    const ch = chunkAtFn(cx,cy);
                    if (ch && ch.name) mountName = ch.name;
                }
                if (!mountName) mountName = natName("Mount");
                const name = "Mount " + mountName;
                const scale = randInt(2,9);
                const dur = Math.max(1, Math.ceil(scale/4));
                const chunks = buildChunks(cx,cy, 3 + Math.floor(scale/4));
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"volcano",duration:dur,scale,name, town:(found.town?found.town.id:null)});
                if (!created) return;
                created.scale = scale;
                if (Array.isArray(created.chunks) && created.chunks.length===0) created.chunks = chunks.slice();
                const affected = townsInChunksList(chunks);
                let totalKilled = 0;
                destroyLandmarks(chunks);
                affected.forEach(tt => {
                    let mitigation = hasHospital(tt) ? 0.5 : 1;
                    const killCount = Math.max(1, Math.ceil((tt.pop||0) * 0.6 * mitigation));
                    totalKilled += killCount;
                    applyTownDamage(tt, 0.6, 0.4, 20, 50);
                });
                
                if (Math.random() < 0.3) {
                    const coastal = findCoastalTownChunk();
                    if (coastal) {
                        const strip = buildCoastalStrip(coastal.cx, coastal.cy, 3);
                        createProcessAndLog({x:coastal.cx,y:coastal.cy,chunks:strip,subtype:"tsunami",duration:2,name:"Tsunami", town:(coastal.town?coastal.town.id:null)});
                    }
                }
                return `${created.name} erupts, killing ${totalKilled} people at ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_tornado", { random:true, weight:2, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.96) return;
                const towns = getAllTowns(); if (!towns.length) return;
                const center = choose(towns);
                const ck = chunkKeyFromTown(center); if (!ck) return;
                const [cx,cy] = ck.split(",").map(Number);
                const ef = choose(["EF0","EF1","EF2","EF3","EF4","EF5"]);
                const dur = clamp(randInt(1,3),1,3);
                const efMap = { "EF0":1, "EF1":1, "EF2":2, "EF3":3, "EF4":4, "EF5":5 };
                const radius = efMap[ef] || 1;
                const chunks = buildChunks(cx,cy,radius); if (!chunks.length) chunks.push([cx,cy]);
                destroyLandmarks(chunks);
                const affected = townsInChunksList(chunks);
                affected.forEach(tt => {
                    applyTownDamage(tt, 0.1 * radius, 0.8, 10, 20 * radius);
                });
                const name = natName("Gale");
                const display = `${name} (${ef})`;
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"tornado",duration:dur,scale:ef,name:display, town:center.id});
                if (created) created.scale = ef;
                return `${display} touches down near ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_tsunami", { random:true, weight:1, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.75) return;
                const found = findCoastalTownChunk(); if (!found) return;
                const length = clamp(randInt(2,4),2,4);
                const strip = buildCoastalStrip(found.cx, found.cy, length);
                if (!strip.length) return;
                destroyLandmarks(strip);
                const affected = townsInChunksList(strip);
                affected.forEach(tt => {
                    applyTownDamage(tt, 0.3, 0.6, 15, 40);
                });
                const created = createProcessAndLog({x:found.cx,y:found.cy,chunks:strip,subtype:"tsunami",duration:2,name:"Tsunami", town:(found.town?found.town.id:null)});
                return `Tsunami pounds the coast near ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_thunderstorm", { random:true, weight:5, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.99) return;
                const towns = getAllTowns(); if (!towns.length) return;
                const center = choose(towns);
                const ck = chunkKeyFromTown(center); if (!ck) return;
                const [cx,cy] = ck.split(",").map(Number);
                const ch = chunkAtFn(cx,cy);
                const isSnow = (ch && ch.b && String(ch.b).toLowerCase().includes("snow")) || (center && center.biome && String(center.biome).toLowerCase().includes("snow"));
                const dur = isSnow ? clamp(randInt(4,10),4,10) : clamp(randInt(4,7),4,7);
                const chunks = buildChunks(cx,cy, 2 + (isSnow ? 1 : 0));
                const name = isSnow ? ("Blizzard " + natName("")) : ("Thunderstorm " + natName(""));
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"thunderstorm",duration:dur,name, town:center.id});
                if (created && created._disaster_mod_uid) {
                    window._disasterMovers[created._disaster_mod_uid] = { uid: created._disaster_mod_uid, subtype: (isSnow ? "blizzard" : "thunderstorm"), speed: 1, vx: (Math.random()-0.5)*0.6, vy: (Math.random()-0.5)*0.6 };
                }
                return `${created.name} moves into the region near ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_sandstorm", { random:true, weight:0.7, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.33) return;
                const f = findDesertChunk(); if (!f) return;
                const dur = clamp(randInt(3,6),3,6);
                const chunks = buildChunks(f.cx,f.cy,2);
                const name = natName("Sandstorm");
                const affected = townsInChunksList(chunks);
                affected.forEach(tt => {
                    dropFaith(tt, 5);
                });
                const created = createProcessAndLog({x:f.cx,y:f.cy,chunks,subtype:"sandstorm",duration:dur,name, town:(f.town?f.town.id:null)});
                if (created && created._disaster_mod_uid) {
                    window._disasterMovers[created._disaster_mod_uid] = { uid: created._disaster_mod_uid, subtype: "sandstorm", speed: 1, vx: (Math.random()-0.5)*0.6, vy: (Math.random()-0.5)*0.6 };
                }
                return `${created.name} sweeps across ${created.locationDesc} for ${dur} day(s).`;
            }
        });

        Mod.event("dis_spawn_meteor", { random:true, weight:0.22, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.12) return;
                const towns = getAllTowns();
                const pickTown = towns && towns.length ? choose(towns) : null;
                let cx,cy;
                if (pickTown) {
                    const ck = chunkKeyFromTown(pickTown);
                    if (ck) [cx,cy] = ck.split(",").map(Number);
                }
                if (cx === undefined) { const c = randomChunkFn(()=>true); if (!c) return; cx=c.x; cy=c.y; }
                const scale = randInt(3,10);
                const instant = Math.random() < 0.35;
                const dur = instant ? 1 : randInt(1,3);
                const chunks = buildChunks(cx,cy, instant?1: (2 + Math.floor(scale/6)));
                const name = natName("Meteor ");
                destroyLandmarks(chunks);
                const affected = townsInChunksList(chunks);
                affected.forEach(tt => {
                    applyTownDamage(tt, 0.4, 0.5, 15, 30);
                });
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"meteor",duration:dur,scale,name, town:(pickTown?pickTown.id:null)});
                if (created) created.instant = instant;
                if (Math.random() < 0.5) {
                    happen("Create", null, null, {x: cx, y: cy, type:"disaster", subtype:"wildfire", duration: 5}, "process");
                }
                return `${created.name} impacts near ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_solar", { random:true, weight:0.5, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.3) return;
                const towns = getAllTowns();
                let centerTown = towns && towns.length ? choose(towns) : null;
                let cx=0, cy=0;
                if (centerTown) {
                    const ck = chunkKeyFromTown(centerTown);
                    if (ck) [cx,cy] = ck.split(",").map(Number);
                } else {
                    const c = randomChunkFn(()=>true);
                    if (!c) return;
                    cx=c.x; cy=c.y;
                }
                const steps = randInt(40,140);
                const patchRadius = randInt(1,6);
                let chunks = buildSolarJagged(cx,cy,steps,patchRadius);
                if (!chunks.length) return;
                const MAX_SOLAR_CHUNKS = 160;
                if (chunks.length > MAX_SOLAR_CHUNKS) chunks = chunks.slice(0, MAX_SOLAR_CHUNKS);
                const set = {}; const out = [];
                for (let i=0;i<chunks.length;i++){
                    const a = [Math.round(chunks[i][0]), Math.round(chunks[i][1])];
                    const k = a[0]+","+a[1];
                    if (!set[k]) { set[k]=true; out.push(a); }
                }
                chunks = out;
                const dur = randInt(30,120);
                const name = "Solar Flare " + uid("SF");
                const affected = townsInChunksList(chunks);
                affected.forEach(tt => dropWealth(tt, 10));
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"solar_flare",duration:dur,scale:null,name, town:(centerTown?centerTown.id:null)});
                if (!created) return;
                try {
                    created.chunks = chunks.slice();
                    created._solar_chunks = chunks.slice();
                    created._solar_days = dur;
                    created.chunks.forEach(c => {
                        const key = c[0] + "," + c[1];
                        const ch = planet && planet.chunks ? planet.chunks[key] : null;
                        if (ch) { ch._solar_days = Math.max(ch._solar_days || 0, dur); ch._solar_affected = true; }
                    });
                } catch(e){}
                return `${created.name} streaks across the skies for ${dur} day(s).`;
            }
        });

        Mod.event("dis_spawn_nuke", { random:true, weight:0.6, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.2) return;
                const towns = getAllTowns();
                const pick = towns && towns.length ? choose(towns) : null;
                let cx,cy;
                if (pick) {
                    const ck = chunkKeyFromTown(pick);
                    if (ck) [cx,cy] = ck.split(",").map(Number);
                }
                if (cx === undefined) { const c = randomChunkFn(()=>true); if (!c) return; cx=c.x; cy=c.y; }
                const radius = 8;
                const chunks = buildChunks(cx,cy,radius);
                const name = "Nuclear Device " + uid("N");
                destroyLandmarks(chunks);
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"nuke",duration:randInt(20,30),name, town:(pick?pick.id:null)});
                markChunksRadioactiveSafely(chunks, randInt(20,30));
                const affected = townsInChunksList(chunks);
                affected.forEach(tt => {
                    applyTownDamage(tt, 0.8, 0.2, 50, 200);
                });
                return `${name} detonated near ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_drought", { random:true, weight:0.8, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.62) return;
                const c = randomChunkFn(()=>true); if (!c) return;
                const cx = c.x, cy = c.y;
                const radius = clamp(randInt(4,8), 4, 10);
                const chunks = buildChunks(cx,cy, radius);
                if (!chunks.length) return;
                const dur = clamp(randInt(4,8), 4, 8);
                const affected = townsInChunksList(chunks);
                affected.forEach(tt => dropFaith(tt, 10));
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"drought",duration:dur, town:null, noName:true});
                if (created) {
                    try {
                        for (let i=0;i<chunks.length;i++){
                            const key = chunks[i][0] + "," + chunks[i][1];
                            const ch = planet && planet.chunks ? planet.chunks[key] : null;
                            if (ch) {
                                ch._drought = true;
                                if (ch._drought_days === undefined) ch._drought_days = dur;
                                else ch._drought_days = Math.max(ch._drought_days, dur);
                                if (Array.isArray(ch.pixels)) ch.pixels.forEach(px => px._drought = true);
                            }
                        }
                    } catch(e){}
                }
                return `A drought affects a wide area near ${created.locationDesc} for ${dur} day(s).`;
            }
        });

        Mod.event("dis_spawn_epidemic", { random:true, weight:1.2, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.88) return;
                const towns = getAllTowns(); if (!towns.length) return;
                const pick = choose(towns);
                if (!pick) return;
                const ck = chunkKeyFromTown(pick); if (!ck) return;
                const [cx,cy] = ck.split(",").map(Number);
                const dur = clamp(randInt(8,16), 6, 24);
                let originAnimal = "livestock";
                try {
                    if (typeof regFilter === "function") {
                        const animals = regFilter("animal", ()=>true);
                        if (Array.isArray(animals) && animals.length) {
                            const a = choose(animals);
                            originAnimal = a && a.species ? a.species : a && a.name ? a.name : originAnimal;
                        }
                    }
                } catch(e){}
                const name = "Epidemic " + uid("E");
                const chunks = buildChunks(cx,cy, 1);
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"epidemic",duration:dur,name, town:pick.id});
                if (created) {
                    created._originAnimal = originAnimal;
                    created._initial_town = pick.id;
                    pick._epidemic_infected = Math.max(1, pick._epidemic_infected || 0) + 1;
                    pick._epidemic_days = Math.max(pick._epidemic_days || 0, dur);
                    pick._epidemic_origin_animal = originAnimal;
                    try { showEpidemicChoiceOnce(created); } catch(e){}
                }
                safeLog(`${created.name} begins at ${created.locationDesc}. Origin: ${originAnimal}.`);
                return `${created.name} begins at ${created.locationDesc}. Origin: ${originAnimal}.`;
            }
        });

        Mod.event("dis_spawn_avalanche", { random:true, weight:0.30, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.90) return;
                const found = findSnowMountainChunk(); if (!found) return;
                const cx = found.cx, cy = found.cy;
                const radius = clamp(randInt(1,3), 1, 3);
                const chunks = buildChunks(cx,cy,radius);
                if (!chunks.length) return;
                destroyLandmarks(chunks);
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"avalanche",duration:1, town:(found.town?found.town.id:null), noName:true});
                if (!created) return;
                const affected = townsInChunksList(chunks);
                affected.forEach(tt => {
                    applyTownDamage(tt, 0.25, 0.7, 5, 10);
                });
                return `An avalanche buries ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_alien_laser", { random:true, weight:0.04, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.02) return;
                const towns = getAllTowns();
                const pickTown = towns && towns.length ? choose(towns) : null;
                let cx,cy;
                if (pickTown) {
                    const ck = chunkKeyFromTown(pickTown);
                    if (ck) [cx,cy] = ck.split(",").map(Number);
                }
                if (cx === undefined) { const c = randomChunkFn(()=>true); if (!c) return; cx=c.x; cy=c.y; }
                const holeRadius = 3;
                const chunks = buildChunks(cx,cy,holeRadius);
                const name = natName("Alien Strike ");
                destroyLandmarks(chunks);
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"alien_laser",duration:999999,name, town:(pickTown?pickTown.id:null)});
                const affectedTowns = townsInChunksList(chunks);
                affectedTowns.forEach(tt => {
                    applyTownDamage(tt, 0.95, 0.2, 30, 999999);
                    tt._killedByAlien = true;
                });
                markAlienHole(chunks);
                return `${created.name} blasts a permanent hole at ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_acid_rain", { random:true, weight:0.4, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.3) return;
                const c = randomChunkFn(()=>true); if (!c) return;
                const chunks = buildChunks(c.x, c.y, randInt(3,6));
                const created = createProcessAndLog({x:c.x,y:c.y,chunks,subtype:"acid_rain",duration:randInt(3,6), town:null});
                return `Acid rain affects ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_magnetic_storm", { random:true, weight:0.2, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.2) return;
                const c = randomChunkFn(()=>true); if (!c) return;
                const chunks = buildChunks(c.x, c.y, randInt(6,12));
                const created = createProcessAndLog({x:c.x,y:c.y,chunks,subtype:"magnetic_storm",duration:randInt(5,10), town:null});
                return `A magnetic storm disrupts ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_industrial_accident", { random:true, weight:0.8, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                const towns = getAllTowns();
                const advancedTowns = towns.filter(tt => planet && planet.unlocks && planet.unlocks.smith > 5);
                if (!advancedTowns.length || Math.random() > 0.8) return;
                const pick = choose(advancedTowns);
                const ck = chunkKeyFromTown(pick); if (!ck) return;
                const [cx,cy] = ck.split(",").map(Number);
                const chunks = buildChunks(cx,cy,1);
                destroyLandmarks(chunks);
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"industrial_accident",duration:randInt(2,4), town:pick.id});
                applyTownDamage(pick, 0.15, 0.9, 20, 100);
                markChunksRadioactiveSafely(chunks, randInt(5,15));
                return `An industrial accident has occurred at ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_locust_swarm", { random:true, weight:0.5, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.2) return;
                const towns = getAllTowns(); if (!towns.length) return;
                const center = choose(towns);
                const ck = chunkKeyFromTown(center); if (!ck) return;
                const [cx,cy] = ck.split(",").map(Number);
                const chunks = buildChunks(cx,cy,2);
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"locust_swarm",duration:randInt(4,8), town:center.id});
                if (created && created._disaster_mod_uid) {
                    window._disasterMovers[created._disaster_mod_uid] = { uid: created._disaster_mod_uid, subtype: "locust_swarm", speed: 1, vx: (Math.random()-0.5)*0.6, vy: (Math.random()-0.5)*0.6 };
                }
                return `A locust swarm descends upon ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_sinkhole", { random:true, weight:0.3, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.1) return;
                const towns = getAllTowns(); if (!towns.length) return;
                const center = choose(towns);
                const ck = chunkKeyFromTown(center); if (!ck) return;
                const [cx,cy] = ck.split(",").map(Number);
                const chunks = buildChunks(cx,cy,1);
                destroyLandmarks(chunks);
                applyTownDamage(center, 0.2, 0.8, 15, 50);
                const created = createProcessAndLog({x:cx,y:cy,chunks,subtype:"sinkhole",duration:1, town:center.id});
                return `A massive sinkhole has swallowed parts of ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_hailstorm", { random:true, weight:1, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.7) return;
                const c = randomChunkFn(()=>true); if (!c) return;
                const chunks = buildChunks(c.x, c.y, randInt(2,4));
                const affected = townsInChunksList(chunks);
                affected.forEach(tt => {
                    applyTownDamage(tt, 0.05, 0.95, 5, 20);
                });
                const created = createProcessAndLog({x:c.x,y:c.y,chunks,subtype:"hailstorm",duration:1, town:null});
                return `A violent hailstorm strikes ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_heatwave", { random:true, weight:0.9, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.65) return;
                const c = randomChunkFn(()=>true); if (!c) return;
                const chunks = buildChunks(c.x, c.y, randInt(4,8));
                const affected = townsInChunksList(chunks);
                affected.forEach(tt => dropFaith(tt, 5));
                const created = createProcessAndLog({x:c.x,y:c.y,chunks,subtype:"heatwave",duration:randInt(5,10), town:null});
                return `A severe heatwave bakes ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_flash_flood", { random:true, weight:0.8, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.6) return;
                const found = findCoastalTownChunk(); if (!found) return;
                const strip = buildCoastalStrip(found.cx, found.cy, 3);
                destroyLandmarks(strip);
                const affected = townsInChunksList(strip);
                affected.forEach(tt => {
                    applyTownDamage(tt, 0.1, 0.9, 10, 80);
                });
                const created = createProcessAndLog({x:found.cx,y:found.cy,chunks:strip,subtype:"flash_flood",duration:1, town:(found.town?found.town.id:null)});
                return `Flash floods wash through ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_deep_freeze", { random:true, weight:0.6, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.5) return;
                const found = findSnowMountainChunk(); if (!found) return;
                const chunks = buildChunks(found.cx, found.cy, randInt(4,8));
                const affected = townsInChunksList(chunks);
                affected.forEach(tt => dropFaith(tt, 5));
                const created = createProcessAndLog({x:found.cx,y:found.cy,chunks,subtype:"deep_freeze",duration:randInt(5,10), town:(found.town?found.town.id:null)});
                return `A deep freeze halts life at ${created.locationDesc}.`;
            }
        });

        Mod.event("dis_spawn_meteor_shower", { random:true, weight:0.3, subject:{reg:"nature",id:1},
            func: (s,t,a) => {
                if (Math.random() > 0.15) return;
                const c = randomChunkFn(()=>true); if (!c) return;
                const chunks = buildChunks(c.x, c.y, randInt(5,10));
                destroyLandmarks(chunks);
                const affected = townsInChunksList(chunks);
                affected.forEach(tt => {
                    applyTownDamage(tt, 0.2, 0.8, 10, 30);
                });
                const created = createProcessAndLog({x:c.x,y:c.y,chunks,subtype:"meteor_shower",duration:1, town:null});
                return `A meteor shower bombards ${created.locationDesc}.`;
            }
        });

    });

})();