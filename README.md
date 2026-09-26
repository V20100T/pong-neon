# Pong Néon

Pong à deux joueurs sur le même clavier, style rétro néon, avec cadeaux, missiles et multi-balle.

**▶ Jouer en ligne : https://v20100t.github.io/pong-neon/**

## Commandes

| | Gauche | Droite | Tir |
|---|---|---|---|
| Joueur 1 (haut) | `Q` | `D` | `S` |
| Joueur 2 (bas, pavé numérique) | `4` | `6` | `8` |

`Entrée` jouer · `Espace` / `Échap` pause · `M` couper le son

## Cadeaux

Un cadeau part de la ligne médiane vers un joueur toutes les 2 à 5 secondes. On l'attrape avec sa raquette.

| Cadeau | Effet |
|---|---|
| 🚀 rouge | Missile (jusqu'à 3, tirés ensemble) : la raquette adverse touchée rétrécit |
| ⟷ vert | Raquette plus longue (jusqu'à 175 %) |
| 🛡 bleu | Bouclier derrière la raquette : renvoie une balle ou absorbe un missile, une fois |
| ● violet | Grosse balle jusqu'à la fin du point |
| ⚡ jaune | Balles plus rapides pendant 6 s |
| 🐢 orange | Balles plus lentes pendant 6 s |
| ×2 / ×3 | Multi-balle : chaque balle sortie donne un point |

Premier à 11 points.

## Contenu du dépôt

- `index.html`, `style.css`, `game.js` : la version web (celle publiée sur GitHub Pages)
- `scratch/` : version Scratch 3 (`Pong.sb3`), générée par `build_sb3.py`
- `go/` : version Go / Ebitengine et son exécutable Windows `Pong.exe`
