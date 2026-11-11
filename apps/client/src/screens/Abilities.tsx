import {
  ABILITIES,
  ME,
  Terrain,
  createSolo,
  resolveRound,
  simulateShot,
  type AbilityId,
  type SoloDef,
} from '@mathbattles/sim';
import { useEffect, useRef, useState } from 'preact/hooks';
import { roundPaths } from '../game/session';
import { t, useLang } from '../i18n';
import { Stage } from '../render/stage';
import { abilityMenu, buyAbility, cosmeticValue, look, ownedAbilities, profile, toggleAbilityFav } from '../store';
import { sound } from '../util';
import { ABILITY_ICON } from './GameView';
import { Icon } from './Icons';
import { TopBar, useProfile } from './Shared';

/** A small board for each ability's demo, with targets placed where the shot really goes. */
function demoBoard(id: AbilityId): { def: SoloDef; expr: string } {
  const base = { mode: 'fn' as const, name: '', abilities: [id], freeEnergy: true };
  if (id === 'hop') {
    // Ride a flat line through a target, then jump the rock at the end.
    return {
      def: { ...base, shooter: { x: 90, y: 300 }, enemies: [{ x: 250, y: 300 }], circles: [{ x: 470, y: 300, r: 48 }, { x: 640, y: 140, r: 40 }] },
      expr: '0',
    };
  }
  const shooter = { x: 90, y: 330 };
  const circles = id === 'ricochet' ? [{ x: 360, y: 170, r: 52 }, { x: 600, y: 360, r: 34 }] : [{ x: 420, y: 330, r: 46 }];
  const expr = id === 'ricochet' ? 'x/2' : '0';
  // Work out where the shot goes on this board, then stand targets on it.
  const path = simulateShot({ mode: 'fn', expr, from: shooter, terrain: new Terrain(circles), targets: [], ricochet: id === 'ricochet' });
  const at = (f: number) => {
    const i = Math.max(1, Math.floor((path.steps - 1) * f));
    return { x: path.xs[i]!, y: path.ys[i]! };
  };
  const enemies = id === 'ricochet'
    ? [at(0.88)]
    : [{ x: path.end.x - 6, y: path.end.y + 30 }, { x: path.end.x - 10, y: path.end.y - 28 }];
  return { def: { ...base, shooter, enemies, circles }, expr };
}

/** Plays an ability's demo on a loop, using the real rules and drawing. */
function AbilityDemo({ id }: { id: AbilityId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const stage = new Stage(ref.current!, 1.2);
    stage.themeId = profile.theme;
    stage.setRockStyle(cosmeticValue('obstacle'));
    stage.looks = { [ME]: look() };
    stage.start();
    let live = true;
    const run = async () => {
      while (live) {
        const { def, expr } = demoBoard(id);
        const state = createSolo(def);
        stage.sync(createSolo(def));
        stage.youId = ME;
        await new Promise((r) => setTimeout(r, 900));
        if (!live) return;
        const board = { circles: state.circles, holes: state.holes.slice() };
        const round = resolveRound(state, [{ playerId: ME, expr, ability: id }]);
        stage.state = state;
        await stage.playRound(round, roundPaths(board, round));
        if (document.hidden) await new Promise((r) => setTimeout(r, 2000));
        await new Promise((r) => setTimeout(r, 700));
      }
    };
    void run();
    return () => {
      live = false;
      stage.stop();
    };
  }, [id]);
  return <canvas class="ability-demo" ref={ref} width={770} height={450} aria-hidden="true" />;
}

/** The Abilities page in the Shop: watch each one, buy it, and mark favourites. */
export function Abilities() {
  useProfile();
  useLang();
  const [note, setNote] = useState('');
  const owned = ownedAbilities();
  const order = abilityMenu();
  return (
    <div class="page">
      <TopBar title={t('ability.title')} />
      <p>{t('ability.intro')}</p>
      <p class="muted small-note"><Icon name="spark" /> {t('ability.sparks', { n: profile.sparks })}</p>
      {note && <p class="error" role="alert">{note}</p>}
      <div class="ability-grid">
        {ABILITIES.map((a) => {
          const has = owned.includes(a.id);
          const fav = profile.abilityFavs.includes(a.id);
          const stats = profile.abilityStats[a.id] ?? { uses: 0, kills: 0 };
          return (
            <div class={`sheet ability-card ${has ? 'owned' : ''}`}>
              <AbilityDemo id={a.id} />
              <div class="ability-card-head">
                <Icon name={ABILITY_ICON[a.id]} size="1.8em" />
                <h3>{t(`ability.${a.id}.name`)}</h3>
                <span class="ability-cost" title={t('energy.label')}><Icon name="energy" />{a.energy}</span>
              </div>
              <p>{t(`ability.${a.id}.long`)}</p>
              <p class="muted small-note">{t('ability.stats', { uses: stats.uses, kills: stats.kills })}</p>
              <div class="row">
                {has ? (
                  <button class={fav ? 'on' : ''} aria-pressed={fav} onClick={() => { toggleAbilityFav(a.id); sound('equip', profile.muted); }}>
                    <Icon name="heart" /> {fav ? t('ability.favourite') : t('ability.makeFavourite')}
                  </button>
                ) : (
                  <button
                    class="primary"
                    onClick={() => {
                      const err = buyAbility(a.id);
                      setNote(err ?? '');
                      sound(err ? 'error' : 'buy', profile.muted);
                    }}
                  >
                    {t('ability.buy', { n: a.price })}
                  </button>
                )}
                {has && a.price === 0 && <small class="muted">{t('ability.free')}</small>}
              </div>
            </div>
          );
        })}
      </div>
      <p class="muted small-note">{t('ability.orderNote', { list: order.map((id) => t(`ability.${id}.name`)).join(', ') })}</p>
    </div>
  );
}
