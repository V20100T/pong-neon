"""Génère Pong.sb3 (projet Scratch 3) à partir de ce script.

Usage : python build_sb3.py  -> écrit Pong.sb3 dans le même dossier.
"""
import hashlib
import itertools
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
_ids = itertools.count(1)


def new_id(prefix='b'):
    return f'{prefix}{next(_ids)}'


# --- Variables et messages globaux --------------------------------------
GLOBAL_VARS = {name: new_id('v') for name in
               ['Score J1', 'Score J2', 'Échange', 'Record échange', 'état',
                'Taille J1', 'Taille J2',      # largeur des raquettes en % (50 à 175)
                'Missile J1', 'Missile J2',    # 1 = missile prêt sur la raquette
                'x J1', 'x J2']}               # position des raquettes, pour les missiles
BROADCASTS = {name: new_id('m') for name in
              ['nouvelle partie', 'pause', 'reprise', 'fin', 'touché J1', 'touché J2']}


# --- Petit DSL pour construire les blocs --------------------------------
class R:
    """Référence à un bloc reporter (slot rond)."""
    def __init__(self, id): self.id = id


class Bo:
    """Référence à un bloc booléen ou à une pile (slot sans ombre)."""
    def __init__(self, id): self.id = id


class M:
    """Référence à un menu (bloc ombre)."""
    def __init__(self, id): self.id = id


class Var:
    def __init__(self, name, id): self.name, self.id = name, id


class Target:
    def __init__(self, name, local_vars=()):
        self.name = name
        self.blocks = {}
        self.vars = {n: new_id('v') for n in local_vars}
        self._y = 0

    def var(self, name):
        if name in self.vars:
            return Var(name, self.vars[name])
        return Var(name, GLOBAL_VARS[name])

    # -- création de blocs --
    def blk(self, op, inputs=None, fields=None, shadow=False):
        id = new_id()
        b = {'opcode': op, 'next': None, 'parent': None, 'inputs': {},
             'fields': fields or {}, 'shadow': shadow, 'topLevel': False}
        self.blocks[id] = b
        for k, v in (inputs or {}).items():
            b['inputs'][k] = self._input(v, id)
        return id

    def _input(self, v, parent):
        if isinstance(v, (R, Bo, M)):
            self.blocks[v.id]['parent'] = parent
            if isinstance(v, R):
                return [3, v.id, [10, '']]
            return [2, v.id] if isinstance(v, Bo) else [1, v.id]
        if isinstance(v, Var):
            return [3, [12, v.name, v.id], [10, '']]
        if isinstance(v, (int, float)):
            return [1, [4, str(v)]]
        return [1, [10, str(v)]]

    def chain(self, ids):
        for a, b in zip(ids, ids[1:]):
            self.blocks[a]['next'] = b
            self.blocks[b]['parent'] = a
        return ids[0] if ids else None

    def sub(self, stmts):
        return Bo(self.chain(stmts))

    def script(self, hat, stmts):
        self.blocks[hat].update(topLevel=True, x=0, y=self._y)
        self._y += 150 + 40 * len(stmts)
        self.chain([hat] + stmts)

    # -- raccourcis --
    def v(self, name):
        return self.var(name)

    def set(self, name, value):
        var = self.var(name)
        return self.blk('data_setvariableto', {'VALUE': value}, {'VARIABLE': [var.name, var.id]})

    def change(self, name, value):
        var = self.var(name)
        return self.blk('data_changevariableby', {'VALUE': value}, {'VARIABLE': [var.name, var.id]})

    def showvar(self, name, show=True):
        var = self.var(name)
        return self.blk('data_showvariable' if show else 'data_hidevariable', fields={'VARIABLE': [var.name, var.id]})

    def op(self, opcode, a, b):
        keys = ('OPERAND1', 'OPERAND2') if opcode in ('operator_equals', 'operator_gt', 'operator_lt',
                                                       'operator_and', 'operator_or') else ('NUM1', 'NUM2')
        wrap = Bo if opcode.startswith('operator_') and opcode.split('_')[1] in ('equals', 'gt', 'lt', 'and', 'or') else R
        return wrap(self.blk(opcode, {keys[0]: a, keys[1]: b}))

    def eq(self, a, b): return self.op('operator_equals', a, b)
    def gt(self, a, b): return self.op('operator_gt', a, b)
    def lt(self, a, b): return self.op('operator_lt', a, b)
    def and_(self, a, b): return self.op('operator_and', a, b)
    def or_(self, a, b): return self.op('operator_or', a, b)
    def not_(self, a): return Bo(self.blk('operator_not', {'OPERAND': a}))
    def add(self, a, b): return self.op('operator_add', a, b)
    def sub_(self, a, b): return self.op('operator_subtract', a, b)
    def mul(self, a, b): return self.op('operator_multiply', a, b)
    def div(self, a, b): return self.op('operator_divide', a, b)

    def mathop(self, fn, x):
        return R(self.blk('operator_mathop', {'NUM': x}, {'OPERATOR': [fn, None]}))

    def random(self, a, b):
        return R(self.blk('operator_random', {'FROM': a, 'TO': b}))

    def if_(self, cond, stmts):
        return self.blk('control_if', {'CONDITION': cond, 'SUBSTACK': self.sub(stmts)})

    def if_else(self, cond, stmts, else_stmts):
        return self.blk('control_if_else', {'CONDITION': cond, 'SUBSTACK': self.sub(stmts),
                                            'SUBSTACK2': self.sub(else_stmts)})

    def repeat(self, n, stmts):
        return self.blk('control_repeat', {'TIMES': n, 'SUBSTACK': self.sub(stmts)})

    def repeat_until(self, cond, stmts):
        return self.blk('control_repeat_until', {'CONDITION': cond, 'SUBSTACK': self.sub(stmts)})

    def forever(self, stmts):
        return self.blk('control_forever', {'SUBSTACK': self.sub(stmts)})

    def wait(self, s):
        return self.blk('control_wait', {'DURATION': s})

    def wait_until(self, cond):
        return self.blk('control_wait_until', {'CONDITION': cond})

    def key_pressed(self, key):
        menu = self.blk('sensing_keyoptions', fields={'KEY_OPTION': [key, None]}, shadow=True)
        return Bo(self.blk('sensing_keypressed', {'KEY_OPTION': M(menu)}))

    def touching(self, sprite):
        menu = self.blk('sensing_touchingobjectmenu', fields={'TOUCHINGOBJECTMENU': [sprite, None]}, shadow=True)
        return Bo(self.blk('sensing_touchingobject', {'TOUCHINGOBJECTMENU': M(menu)}))

    def goto(self, x, y): return self.blk('motion_gotoxy', {'X': x, 'Y': y})
    def setx(self, x): return self.blk('motion_setx', {'X': x})
    def changex(self, d): return self.blk('motion_changexby', {'DX': d})
    def changey(self, d): return self.blk('motion_changeyby', {'DY': d})
    def xpos(self): return R(self.blk('motion_xposition'))
    def ypos(self): return R(self.blk('motion_yposition'))
    def show(self): return self.blk('looks_show')
    def hide(self): return self.blk('looks_hide')
    def front(self): return self.blk('looks_gotofrontback', fields={'FRONT_BACK': ['front', None]})

    def ghost(self, value):
        return self.blk('looks_seteffectto', {'VALUE': value}, {'EFFECT': ['GHOST', None]})

    def costume_num(self, value):
        """Change de costume selon un numéro calculé (le menu reste en ombre sous le reporter)."""
        id = self.blk('looks_switchcostumeto', {'COSTUME': value})
        menu = self.blk('looks_costume', fields={'COSTUME': ['', None]}, shadow=True)
        self.blocks[menu]['parent'] = id
        self.blocks[id]['inputs']['COSTUME'][2] = menu
        return id

    def costume(self, name):
        menu = self.blk('looks_costume', fields={'COSTUME': [name, None]}, shadow=True)
        return self.blk('looks_switchcostumeto', {'COSTUME': M(menu)})

    def broadcast(self, name):
        id = self.blk('event_broadcast')
        self.blocks[id]['inputs']['BROADCAST_INPUT'] = [1, [11, name, BROADCASTS[name]]]
        return id

    # -- chapeaux --
    def on_flag(self): return self.blk('event_whenflagclicked')

    def on_key(self, key):
        return self.blk('event_whenkeypressed', fields={'KEY_OPTION': [key, None]})

    def on_msg(self, name):
        return self.blk('event_whenbroadcastreceived', fields={'BROADCAST_OPTION': [name, BROADCASTS[name]]})


# --- Graphismes (SVG) ----------------------------------------------------
PINK, CYAN = '#ff2bd6', '#19f0ff'
FONT = 'font-family="Sans Serif" text-anchor="middle"'

BACKDROP = f'''<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
<rect width="480" height="360" fill="#07021a"/>
<rect x="2" y="2" width="476" height="178" fill="none" stroke="{PINK}" stroke-width="3"/>
<rect x="2" y="180" width="476" height="178" fill="none" stroke="{CYAN}" stroke-width="3"/>
<line x1="0" y1="180" x2="480" y2="180" stroke="#e8e6ff" stroke-opacity=".35" stroke-width="3" stroke-dasharray="12 10"/>
</svg>'''


# Tailles de raquette en % : le costume n° k correspond à PADDLE_SIZES[k-1]
PADDLE_SIZES = [50, 75, 100, 125, 150, 175]


def paddle_svg(color, pct):
    w = round(84 * pct / 100)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="14" viewBox="0 0 {w} 14">
<rect x="0" y="0" width="{w}" height="14" rx="7" fill="{color}" fill-opacity=".3"/>
<rect x="2" y="2" width="{w - 4}" height="10" rx="5" fill="{color}"/>
</svg>'''


def gift_svg(color):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
<rect x="0" y="0" width="26" height="26" rx="6" fill="{color}" fill-opacity=".3"/>
<rect x="3" y="3" width="20" height="20" rx="4" fill="{color}"/>
<rect x="11" y="3" width="4" height="20" fill="#ffffff" fill-opacity=".85"/>
<rect x="3" y="11" width="20" height="4" fill="#ffffff" fill-opacity=".85"/>
</svg>'''


def missile_svg(color, down):
    """Missile de 10x24, pointe vers le haut (ou vers le bas si down)."""
    flip = ' transform="rotate(180 5 12)"' if down else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="10" height="24" viewBox="0 0 10 24">
<g{flip}>
<path d="M3 19 L5 24 L7 19 Z" fill="#ffb02e"/>
<path d="M0 19 L3 14 L3 19 Z M10 19 L7 14 L7 19 Z" fill="{color}"/>
<rect x="3" y="7" width="4" height="13" fill="#e8e6ff"/>
<path d="M3 7 L5 0 L7 7 Z" fill="{color}"/>
</g>
</svg>'''


BALL = '''<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
<circle cx="8" cy="8" r="8" fill="#ffffff" fill-opacity=".3"/>
<circle cx="8" cy="8" r="6" fill="#ffffff"/>
</svg>'''


def panel_svg(color, lines, h=190):
    """Panneau 360 x h avec lignes (texte, taille, couleur)."""
    y, texts = 24, []
    for text, size, fill in lines:
        y += size + 8
        texts.append(f'<text x="180" y="{y}" {FONT} font-size="{size}" fill="{fill}">{text}</text>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="360" height="{h}" viewBox="0 0 360 {h}">
<rect x="2" y="2" width="356" height="{h - 4}" rx="12" fill="#05010f" fill-opacity=".88" stroke="{color}" stroke-width="3"/>
{chr(10).join(texts)}
</svg>'''


WHITE = '#e8e6ff'
RED, GREEN = '#ff4b4b', '#2bff88'
MSG_COSTUMES = {
    'titre': panel_svg(CYAN, [('PONG', 40, '#ffffff'),
                              ('Joueur 1 (haut) : Q / D · tir S', 15, PINK),
                              ('Joueur 2 (bas) : 4 / 6 · tir 8', 15, CYAN),
                              ('Cadeau rouge : missile', 13, RED),
                              ('Cadeau vert : raquette plus longue', 13, GREEN),
                              ('Premier à 11 points', 13, WHITE),
                              ('ESPACE pour jouer · ESPACE = pause', 13, WHITE)], h=230),
    'pause': panel_svg(WHITE, [('', 10, WHITE), ('PAUSE', 40, '#ffffff'),
                               ('ESPACE pour reprendre', 16, WHITE)]),
    'j1': panel_svg(PINK, [('', 4, WHITE), ('Joueur 1', 34, PINK), ('gagne !', 28, PINK),
                           ('ESPACE pour rejouer', 14, WHITE)]),
    'j2': panel_svg(CYAN, [('', 4, WHITE), ('Joueur 2', 34, CYAN), ('gagne !', 28, CYAN),
                           ('ESPACE pour rejouer', 14, WHITE)]),
}

assets = {}


def costume(name, svg, cx, cy):
    data = svg.encode('utf-8')
    md5 = hashlib.md5(data).hexdigest()
    assets[md5 + '.svg'] = data
    return {'name': name, 'bitmapResolution': 1, 'dataFormat': 'svg', 'assetId': md5,
            'md5ext': md5 + '.svg', 'rotationCenterX': cx, 'rotationCenterY': cy}


# --- Scène ---------------------------------------------------------------
stage = Target('Stage')
s = stage
s.script(s.on_flag(), [
    s.set('état', 'titre'),
    s.set('Score J1', 0), s.set('Score J2', 0), s.set('Échange', 0),
    s.showvar('Record échange', False),
])
s.script(s.on_key('space'), [
    s.if_else(s.or_(s.eq(s.v('état'), 'titre'), s.eq(s.v('état'), 'fin')),
              [s.set('état', 'jeu'), s.broadcast('nouvelle partie')],
              [s.if_else(s.eq(s.v('état'), 'jeu'),
                         [s.set('état', 'pause'), s.broadcast('pause')],
                         [s.if_(s.eq(s.v('état'), 'pause'),
                                [s.set('état', 'jeu'), s.broadcast('reprise')])])]),
])

# --- Balle ---------------------------------------------------------------
ball = Target('Balle', ['dx', 'dy', 'vitesse', 'angle', 'facteur', 'point', 'sens'])
b = ball
b.script(b.on_flag(), [b.hide(), b.goto(0, 0), b.ghost(0)])

serve = [
    b.goto(0, 0),
    b.set('Échange', 0),
    b.set('vitesse', 6),
    # Clignotement pendant ~1 s avant l'engagement
    b.repeat(6, [b.wait_until(b.eq(b.v('état'), 'jeu')),
                 b.ghost(80), b.wait(0.08), b.ghost(0), b.wait(0.08)]),
    # Angle aléatoire entre 15° et 40° par rapport à la verticale
    b.set('angle', b.random(15, 40)),
    b.if_(b.eq(b.random(1, 2), 1), [b.set('angle', b.sub_(0, b.v('angle')))]),
    b.set('dx', b.mul(b.v('vitesse'), b.mathop('sin', b.v('angle')))),
    b.set('dy', b.mul(b.mul(b.v('vitesse'), b.mathop('cos', b.v('angle'))), b.v('sens'))),
    b.set('point', 0),
    b.repeat_until(b.eq(b.v('point'), 1), [
        b.wait_until(b.eq(b.v('état'), 'jeu')),
        b.changex(b.v('dx')),
        b.changey(b.v('dy')),
        # Murs latéraux
        b.if_(b.gt(b.xpos(), 234), [b.setx(234), b.set('dx', b.sub_(0, b.mathop('abs', b.v('dx'))))]),
        b.if_(b.lt(b.xpos(), -234), [b.setx(-234), b.set('dx', b.mathop('abs', b.v('dx')))]),
        # Raquettes (seulement si la balle se dirige vers elles)
        b.if_(b.or_(b.and_(b.gt(b.v('dy'), 0), b.touching('Raquette J1')),
                    b.and_(b.lt(b.v('dy'), 0), b.touching('Raquette J2'))), [
            b.change('Échange', 1),
            b.if_(b.gt(b.v('Échange'), b.v('Record échange')),
                  [b.set('Record échange', b.v('Échange'))]),
            # Accélération de 6 % par renvoi, plafonnée à 14
            b.set('facteur', 1.06),
            b.if_(b.gt(b.mul(b.v('vitesse'), b.v('facteur')), 14),
                  [b.set('facteur', b.div(14, b.v('vitesse')))]),
            b.set('vitesse', b.mul(b.v('vitesse'), b.v('facteur'))),
            b.set('dx', b.mul(b.v('dx'), b.v('facteur'))),
            b.set('dy', b.mul(b.sub_(0, b.v('dy')), b.v('facteur'))),
        ]),
        # Buts : le perdant du point reçoit l'engagement
        b.if_(b.gt(b.ypos(), 172), [b.change('Score J2', 1), b.set('sens', 1), b.set('point', 1)]),
        b.if_(b.lt(b.ypos(), -172), [b.change('Score J1', 1), b.set('sens', -1), b.set('point', 1)]),
    ]),
]

b.script(b.on_msg('nouvelle partie'), [
    b.set('Score J1', 0), b.set('Score J2', 0),
    b.set('Échange', 0), b.set('Record échange', 0),
    b.showvar('Record échange', False),
    b.set('sens', b.sub_(b.mul(b.random(0, 1), 2), 1)),
    b.show(),
    b.repeat_until(b.or_(b.gt(b.v('Score J1'), 10), b.gt(b.v('Score J2'), 10)), serve),
    b.set('état', 'fin'),
    b.hide(),
    b.showvar('Record échange'),
    b.broadcast('fin'),
])


# --- Raquettes -----------------------------------------------------------
def make_paddle(name, player, y, left, right):
    p = Target(name, ['limite'])
    taille = f'Taille {player}'
    p.script(p.on_flag(), [
        p.goto(0, y),
        p.set(taille, 100),
        p.forever([
            # Costume selon la taille : 50 % -> n° 1, 75 % -> n° 2, … 175 % -> n° 6
            p.costume_num(p.sub_(p.div(p.v(taille), 25), 1)),
            # Demi-largeur de la raquette = 42 px à 100 %
            p.set('limite', p.sub_(240, p.mul(p.v(taille), 0.42))),
            p.if_(p.eq(p.v('état'), 'jeu'), [
                p.if_(p.key_pressed(left), [p.changex(-8)]),
                p.if_(p.key_pressed(right), [p.changex(8)]),
                p.if_(p.lt(p.xpos(), p.sub_(0, p.v('limite'))), [p.setx(p.sub_(0, p.v('limite')))]),
                p.if_(p.gt(p.xpos(), p.v('limite')), [p.setx(p.v('limite'))]),
            ]),
            p.set(f'x {player}', p.xpos()),
        ]),
    ])
    p.script(p.on_msg('nouvelle partie'), [p.goto(0, y), p.set(taille, 100)])
    # Clignote quand un missile la touche
    p.script(p.on_msg(f'touché {player}'), [
        p.repeat(4, [p.ghost(75), p.wait(0.05), p.ghost(0), p.wait(0.05)]),
    ])
    return p


paddle1 = make_paddle('Raquette J1', 'J1', 150, 'q', 'd')
paddle2 = make_paddle('Raquette J2', 'J2', -150, '4', '6')


def running(t):
    """« Le jeu tourne ou est fini » : attend la fin d'une pause sans bloquer en fin de partie."""
    return t.or_(t.eq(t.v('état'), 'jeu'), t.eq(t.v('état'), 'fin'))


# --- Missiles ------------------------------------------------------------
def make_missile(player, opponent, key, y_rest, dy):
    t = Target(f'Missile {player}')
    missile, target = f'Missile {player}', f'Raquette {opponent}'

    def fin():
        return t.eq(t.v('état'), 'fin')

    t.script(t.on_flag(), [t.hide()])
    t.script(t.on_msg('nouvelle partie'), [
        t.hide(),
        t.set(missile, 0),
        t.repeat_until(fin(), [
            t.wait_until(running(t)),
            t.if_else(t.and_(t.eq(t.v(missile), 1), t.not_(fin())), [
                # Missile prêt : posé sur la raquette, côté adversaire
                t.goto(t.v(f'x {player}'), y_rest),
                t.show(),
                t.if_(t.key_pressed(key), [
                    t.set(missile, 0),
                    t.repeat_until(t.or_(t.or_(t.gt(t.mathop('abs', t.ypos()), 178),
                                               t.touching(target)), fin()), [
                        t.wait_until(running(t)),
                        t.changey(dy),
                    ]),
                    t.if_(t.touching(target), [
                        # La raquette touchée rétrécit de 25 % (minimum 50 %)
                        t.if_(t.gt(t.v(f'Taille {opponent}'), 50), [t.change(f'Taille {opponent}', -25)]),
                        t.broadcast(f'touché {opponent}'),
                    ]),
                    t.hide(),
                ]),
            ], [t.hide()]),
        ]),
        t.hide(),
    ])
    return t


missile1 = make_missile('J1', 'J2', 's', 134, -10)
missile2 = make_missile('J2', 'J1', '8', -134, 10)

# --- Cadeaux -------------------------------------------------------------
gift = Target('Cadeau', ['attente', 'type', 'sens', 'fini'])
c = gift


def gift_fin():
    return c.eq(c.v('état'), 'fin')


def give(player):
    return [
        c.if_else(c.eq(c.v('type'), 1),
                  [c.set(f'Missile {player}', 1)],            # attaque : un seul missile à la fois
                  [c.if_(c.lt(c.v(f'Taille {player}'), 175),  # défense : raquette +25 %
                         [c.change(f'Taille {player}', 25)])]),
        c.set('fini', 1),
    ]


c.script(c.on_flag(), [c.hide()])
c.script(c.on_msg('nouvelle partie'), [
    c.hide(),
    c.repeat_until(gift_fin(), [
        # Attente de 3 à 7 s de jeu (la pause ne compte pas)
        c.set('attente', c.random(3, 7)),
        c.repeat_until(c.or_(c.lt(c.v('attente'), 0), gift_fin()), [
            c.wait_until(running(c)), c.wait(0.1), c.change('attente', -0.1),
        ]),
        c.if_(c.not_(gift_fin()), [
            c.set('type', c.random(1, 2)),                        # 1 = attaque (rouge), 2 = défense (vert)
            c.costume_num(c.v('type')),
            c.set('sens', c.sub_(c.mul(c.random(0, 1), 2), 1)),  # 1 = vers J1 (haut), -1 = vers J2
            c.goto(c.random(-200, 200), 0),
            c.front(),
            c.show(),
            c.set('fini', 0),
            c.repeat_until(c.eq(c.v('fini'), 1), [
                c.wait_until(running(c)),
                c.changey(c.mul(c.v('sens'), 3)),
                c.if_(c.touching('Raquette J1'), give('J1')),
                c.if_(c.touching('Raquette J2'), give('J2')),
                c.if_(c.or_(c.gt(c.mathop('abs', c.ypos()), 172), gift_fin()), [c.set('fini', 1)]),
            ]),
            c.hide(),
        ]),
    ]),
    c.hide(),
])

# --- Message (titre / pause / victoire) ----------------------------------
msg = Target('Message')
m = msg
m.script(m.on_flag(), [m.goto(0, 0), m.front(), m.costume('titre'), m.show()])
m.script(m.on_msg('nouvelle partie'), [m.hide()])
m.script(m.on_msg('reprise'), [m.hide()])
m.script(m.on_msg('pause'), [m.costume('pause'), m.front(), m.show()])
m.script(m.on_msg('fin'), [
    m.if_else(m.gt(m.v('Score J1'), 10), [m.costume('j1')], [m.costume('j2')]),
    m.front(), m.show(),
])


# --- Assemblage ----------------------------------------------------------
def sprite_json(t, costumes, layer, x=0, y=0, visible=True, costume_index=0):
    return {'isStage': False, 'name': t.name,
            'variables': {id: [n, 0] for n, id in t.vars.items()},
            'lists': {}, 'broadcasts': {}, 'blocks': t.blocks, 'comments': {},
            'currentCostume': costume_index, 'costumes': costumes, 'sounds': [], 'volume': 100,
            'layerOrder': layer, 'visible': visible, 'x': x, 'y': y, 'size': 100,
            'direction': 90, 'draggable': False, 'rotationStyle': 'don\'t rotate'}


stage_json = {
    'isStage': True, 'name': 'Stage',
    'variables': {id: [n, {'état': 'titre', 'Taille J1': 100, 'Taille J2': 100}.get(n, 0)]
                  for n, id in GLOBAL_VARS.items()},
    'lists': {}, 'broadcasts': {id: n for n, id in BROADCASTS.items()},
    'blocks': stage.blocks, 'comments': {}, 'currentCostume': 0,
    'costumes': [costume('terrain', BACKDROP, 240, 180)], 'sounds': [], 'volume': 100,
    'layerOrder': 0, 'tempo': 60, 'videoTransparency': 50, 'videoState': 'on',
    'textToSpeechLanguage': None,
}


def monitor(name, x, y, mode='default', visible=True):
    return {'id': GLOBAL_VARS[name], 'mode': mode, 'opcode': 'data_variable',
            'params': {'VARIABLE': name}, 'spriteName': None, 'value': 0,
            'width': 0, 'height': 0, 'x': x, 'y': y, 'visible': visible,
            'sliderMin': 0, 'sliderMax': 100, 'isDiscrete': True}


def paddle_costumes(color):
    return [costume(f'{pct} %', paddle_svg(color, pct), round(84 * pct / 100) / 2, 7)
            for pct in PADDLE_SIZES]


project = {
    'targets': [
        stage_json,
        sprite_json(paddle1, paddle_costumes(PINK), 1, 0, 150, costume_index=2),
        sprite_json(paddle2, paddle_costumes(CYAN), 2, 0, -150, costume_index=2),
        sprite_json(missile1, [costume('missile', missile_svg(PINK, down=True), 5, 12)], 3, visible=False),
        sprite_json(missile2, [costume('missile', missile_svg(CYAN, down=False), 5, 12)], 4, visible=False),
        sprite_json(gift, [costume('attaque', gift_svg(RED), 13, 13),
                           costume('défense', gift_svg(GREEN), 13, 13)], 5, visible=False),
        sprite_json(ball, [costume('balle', BALL, 8, 8)], 6, visible=False),
        sprite_json(msg, [costume(n, svg, 180, 115 if n == 'titre' else 95)
                          for n, svg in MSG_COSTUMES.items()], 7),
    ],
    'monitors': [
        monitor('Score J1', 8, 140, 'large'),
        monitor('Score J2', 8, 190, 'large'),
        monitor('Échange', 385, 155),
        monitor('Record échange', 165, 285, visible=False),
    ],
    'extensions': [],
    'meta': {'semver': '3.0.0', 'vm': '0.2.0', 'agent': ''},
}

out = os.path.join(HERE, 'Pong.sb3')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('project.json', json.dumps(project, ensure_ascii=False))
    for name, data in assets.items():
        z.writestr(name, data)
print('OK ->', out, f'({sum(len(t["blocks"]) for t in project["targets"])} blocs)')
