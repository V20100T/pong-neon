// Pong Néon — version Go (Ebitengine), portage de la version HTML/JS.
package main

import (
	"bytes"
	"fmt"
	"image/color"
	"log"
	"math"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/inpututil"
	"github.com/hajimehoshi/ebiten/v2/text/v2"
	"github.com/hajimehoshi/ebiten/v2/vector"
	"golang.org/x/image/font/gofont/gomono"
	"golang.org/x/image/font/gofont/gomonobold"
)

// --- Réglages ---------------------------------------------------------------
const (
	W              = 600.0 // largeur logique du terrain
	H              = 900.0 // hauteur logique du terrain
	WinScore       = 11
	PaddleW        = 110.0
	PaddleH        = 14.0
	PaddleMargin   = 40.0  // distance raquette / bord
	PaddleSpeed    = 650.0 // px/s
	BallR          = 9.0
	BallStartSpeed = 420.0
	BallAccel      = 1.06 // +6 % à chaque renvoi
	BallMaxSpeed   = 1150.0
	ServeDelay     = 1.0  // secondes avant l'engagement
	TrailTime      = 0.23 // durée de la traînée de la balle, en secondes
	MaxDT          = 0.05 // pas de temps maximal (après un blocage de la fenêtre)
	FieldFill      = 0.9  // part de la fenêtre occupée par le terrain
	FieldFillFull  = 0.8  // idem en plein écran, pour garder de la marge
	WindowFill     = 0.5  // hauteur initiale de la fenêtre, en part de la hauteur de l'écran
)

var (
	colP1    = color.NRGBA{0xff, 0x2b, 0xd6, 0xff}
	colP2    = color.NRGBA{0x19, 0xf0, 0xff, 0xff}
	colText  = color.NRGBA{0xe8, 0xe6, 0xff, 0xff}
	colField = color.NRGBA{0x07, 0x02, 0x1a, 0xff}
	colBg    = color.NRGBA{0x05, 0x01, 0x0f, 0xff}
	colWhite = color.NRGBA{0xff, 0xff, 0xff, 0xff}
)

type state int

const (
	stMenu state = iota
	stServe
	stPlay
	stPaused
	stOver
)

type paddle struct {
	x, y  float64
	score int
	color color.NRGBA
}

type point struct{ x, y, t float64 }

type ball struct {
	x, y, vx, vy, speed float64
	trail               []point
}

type Game struct {
	p1, p2       paddle
	ball         ball
	state        state
	pausedFrom   state
	serveTimer   float64
	serveDir     float64 // 1 = vers le bas (joueur 2), -1 = vers le haut (joueur 1)
	rally        int     // renvois dans l'échange en cours
	longestRally int     // plus long échange de la partie
	winner       *paddle

	keyQ, keyD ebiten.Key // touches Q et D selon la disposition du clavier (AZERTY, QWERTY…)
	keyRefresh int

	field *ebiten.Image
	// Rendus mis en cache : recalculés seulement quand leur contenu ou la taille change
	bgLayer, scoreLayer, overlayLayer       layer
	pad1Sprite, pad2Sprite, ballSprite, dot layer
	lastUpdate                              time.Time
	now                                     float64 // temps de jeu écoulé, en secondes
	fontReg, fontBold                       *text.GoTextFaceSource
}

func NewGame() *Game {
	reg, err := text.NewGoTextFaceSource(bytes.NewReader(gomono.TTF))
	if err != nil {
		log.Fatal(err)
	}
	bold, err := text.NewGoTextFaceSource(bytes.NewReader(gomonobold.TTF))
	if err != nil {
		log.Fatal(err)
	}
	g := &Game{
		p1:       paddle{x: (W - PaddleW) / 2, y: PaddleMargin, color: colP1},
		p2:       paddle{x: (W - PaddleW) / 2, y: H - PaddleMargin - PaddleH, color: colP2},
		ball:     ball{x: W / 2, y: H / 2, speed: BallStartSpeed},
		state:    stMenu,
		fontReg:  reg,
		fontBold: bold,
	}
	g.refreshLetterKeys()
	return g
}

// --- Clavier ----------------------------------------------------------------

// Ebitengine nomme les touches selon leur position sur un clavier QWERTY :
// on cherche donc la touche physique qui produit « q » / « d » sur le clavier réel.
func letterKey(letter string, fallback ebiten.Key) ebiten.Key {
	for k := ebiten.KeyA; k <= ebiten.KeyZ; k++ {
		if strings.EqualFold(ebiten.KeyName(k), letter) {
			return k
		}
	}
	return fallback
}

func (g *Game) refreshLetterKeys() {
	g.keyQ = letterKey("q", ebiten.KeyQ)
	g.keyD = letterKey("d", ebiten.KeyD)
}

func justPressed(keys ...ebiten.Key) bool {
	for _, k := range keys {
		if inpututil.IsKeyJustPressed(k) {
			return true
		}
	}
	return false
}

// --- Déroulement de la partie -----------------------------------------------
func (g *Game) startGame() {
	g.p1.score, g.p2.score = 0, 0
	g.longestRally = 0
	g.winner = nil
	g.p1.x = (W - PaddleW) / 2
	g.p2.x = g.p1.x
	g.serveDir = 1
	if rand.IntN(2) == 0 {
		g.serveDir = -1
	}
	g.prepareServe()
}

func (g *Game) prepareServe() {
	g.ball = ball{x: W / 2, y: H / 2, speed: BallStartSpeed}
	g.rally = 0
	g.serveTimer = ServeDelay
	g.state = stServe
}

func (g *Game) launchBall() {
	// Angle aléatoire entre 15° et 40° par rapport à la verticale
	angle := (15 + rand.Float64()*25) * math.Pi / 180
	if rand.IntN(2) == 0 {
		angle = -angle
	}
	g.ball.vx = math.Sin(angle) * g.ball.speed
	g.ball.vy = math.Cos(angle) * g.ball.speed * g.serveDir
	g.state = stPlay
}

func (g *Game) pause() {
	g.pausedFrom = g.state
	g.state = stPaused
}

func (g *Game) resume() { g.state = g.pausedFrom }

func (g *Game) scorePoint(p *paddle) {
	p.score++
	if p.score >= WinScore {
		g.winner = p
		g.state = stOver
		return
	}
	// Le perdant du point reçoit l'engagement
	if p == &g.p1 {
		g.serveDir = 1
	} else {
		g.serveDir = -1
	}
	g.prepareServe()
}

// --- Mise à jour ------------------------------------------------------------
func movePaddle(p *paddle, left, right bool, dt float64) {
	dir := 0.0
	if right {
		dir++
	}
	if left {
		dir--
	}
	p.x = math.Max(0, math.Min(W-PaddleW, p.x+dir*PaddleSpeed*dt))
}

func (g *Game) hitsPaddle(p *paddle) bool {
	b := &g.ball
	return b.x+BallR >= p.x && b.x-BallR <= p.x+PaddleW &&
		b.y+BallR >= p.y && b.y-BallR <= p.y+PaddleH
}

func (g *Game) bounceOffPaddle(p *paddle, goingDown bool) {
	g.rally++
	g.longestRally = max(g.longestRally, g.rally)
	b := &g.ball
	b.speed = math.Min(b.speed*BallAccel, BallMaxSpeed)
	ratio := b.speed / math.Hypot(b.vx, b.vy)
	b.vx *= ratio
	b.vy = -b.vy * ratio
	// Replace la balle hors de la raquette pour éviter un double contact
	if goingDown {
		b.y = p.y - BallR
	} else {
		b.y = p.y + PaddleH + BallR
	}
}

// stepBall avance la balle d'un sous-pas ; renvoie false si un point a été marqué.
func (g *Game) stepBall(dt float64) bool {
	b := &g.ball
	b.x += b.vx * dt
	b.y += b.vy * dt

	// Murs latéraux
	if b.x-BallR < 0 {
		b.x, b.vx = BallR, math.Abs(b.vx)
	} else if b.x+BallR > W {
		b.x, b.vx = W-BallR, -math.Abs(b.vx)
	}

	// Raquettes (uniquement si la balle se dirige vers elles)
	if b.vy < 0 && g.hitsPaddle(&g.p1) {
		g.bounceOffPaddle(&g.p1, false)
	} else if b.vy > 0 && g.hitsPaddle(&g.p2) {
		g.bounceOffPaddle(&g.p2, true)
	}

	// Buts
	if b.y+BallR < 0 {
		g.scorePoint(&g.p2)
		return false
	}
	if b.y-BallR > H {
		g.scorePoint(&g.p1)
		return false
	}
	return true
}

func (g *Game) Update() error {
	// Une mise à jour par image affichée, avec le temps réellement écoulé :
	// mouvement fluide quelle que soit la fréquence de l'écran (60, 144 Hz…)
	t := time.Now()
	dt := MaxDT
	if !g.lastUpdate.IsZero() {
		dt = math.Min(t.Sub(g.lastUpdate).Seconds(), MaxDT)
	}
	g.lastUpdate = t

	if g.keyRefresh--; g.keyRefresh <= 0 { // la disposition du clavier peut changer en cours de route
		g.refreshLetterKeys()
		g.keyRefresh = 60
	}

	if justPressed(ebiten.KeyF11) {
		ebiten.SetFullscreen(!ebiten.IsFullscreen())
	}

	// Pause automatique si la fenêtre perd le focus
	if !ebiten.IsFocused() && (g.state == stPlay || g.state == stServe) {
		g.pause()
	}

	switch {
	case justPressed(ebiten.KeyEnter, ebiten.KeyNumpadEnter):
		switch g.state {
		case stMenu, stOver:
			g.startGame()
		case stPaused:
			g.resume()
		}
	case justPressed(ebiten.KeySpace, ebiten.KeyEscape):
		switch g.state {
		case stPlay, stServe:
			g.pause()
		case stPaused:
			g.resume()
		}
	}

	if g.state == stServe || g.state == stPlay {
		movePaddle(&g.p1, ebiten.IsKeyPressed(g.keyQ), ebiten.IsKeyPressed(g.keyD), dt)
		movePaddle(&g.p2, ebiten.IsKeyPressed(ebiten.KeyNumpad4), ebiten.IsKeyPressed(ebiten.KeyNumpad6), dt)
	}

	switch g.state {
	case stServe:
		g.serveTimer -= dt
		if g.serveTimer <= 0 {
			g.launchBall()
		}
	case stPlay:
		// Sous-pas pour éviter que la balle traverse une raquette à grande vitesse
		g.now += dt
		steps := int(math.Ceil(g.ball.speed * dt / (BallR * 0.8)))
		for range steps {
			if !g.stepBall(dt / float64(steps)) {
				break
			}
		}
		if g.state == stPlay {
			g.ball.trail = append(g.ball.trail, point{g.ball.x, g.ball.y, g.now})
			for len(g.ball.trail) > 0 && g.now-g.ball.trail[0].t > TrailTime {
				g.ball.trail = g.ball.trail[1:]
			}
		}
	}
	return nil
}

// --- Rendu (coordonnées logiques, converties via S) --------------------------

// layer est une image mise en cache, redessinée seulement quand sa clé change.
type layer struct {
	img *ebiten.Image
	key string
}

func (l *layer) get(key string, w, h float64, render func(dst *ebiten.Image)) *ebiten.Image {
	pw, ph := int(math.Ceil(w*S)), int(math.Ceil(h*S))
	key = fmt.Sprintf("%s|%.4f", key, S)
	if l.img != nil && l.key == key {
		return l.img
	}
	if l.img == nil || l.img.Bounds().Dx() != pw || l.img.Bounds().Dy() != ph {
		if l.img != nil {
			l.img.Deallocate()
		}
		l.img = ebiten.NewImage(pw, ph)
	} else {
		l.img.Clear()
	}
	render(l.img)
	l.key = key
	return l.img
}

// blit dessine img avec son coin haut-gauche en (x, y), coordonnées logiques.
func blit(dst, img *ebiten.Image, x, y float64, cs ebiten.ColorScale) {
	op := &ebiten.DrawImageOptions{Filter: ebiten.FilterLinear, ColorScale: cs}
	op.GeoM.Translate(x*S, y*S)
	dst.DrawImage(img, op)
}

const (
	padMargin  = 22.0 // place autour d'une raquette pour son halo
	ballMargin = 26.0 // place autour de la balle pour son halo
)

// S : pixels écran par unité logique, recalculé à chaque image pour un rendu net à toute taille.
var S = 1.0

func withAlpha(c color.NRGBA, a float64) color.NRGBA {
	c.A = uint8(math.Round(float64(c.A) * math.Max(0, math.Min(1, a))))
	return c
}

func fillRect(dst *ebiten.Image, x, y, w, h float64, c color.Color) {
	vector.FillRect(dst, float32(x*S), float32(y*S), float32(w*S), float32(h*S), c, true)
}

func strokeRect(dst *ebiten.Image, x, y, w, h, lw float64, c color.Color) {
	vector.StrokeRect(dst, float32(x*S), float32(y*S), float32(w*S), float32(h*S), float32(lw*S), c, true)
}

func fillCircle(dst *ebiten.Image, x, y, r float64, c color.Color) {
	vector.FillCircle(dst, float32(x*S), float32(y*S), float32(r*S), c, true)
}

func line(dst *ebiten.Image, x0, y0, x1, y1, lw float64, c color.Color) {
	vector.StrokeLine(dst, float32(x0*S), float32(y0*S), float32(x1*S), float32(y1*S), float32(lw*S), c, true)
}

// pill dessine un rectangle aux extrémités arrondies (raquettes), en une seule forme
// pour que la transparence ne se cumule pas là où les morceaux se chevaucheraient.
func pill(dst *ebiten.Image, x, y, w, h float64, c color.Color) {
	r := float32(h / 2 * S)
	x0, y0, x1 := float32(x*S)+r, float32(y*S)+r, float32((x+w)*S)-r
	var p vector.Path
	p.Arc(x0, y0, r, math.Pi/2, 3*math.Pi/2, vector.Clockwise)
	p.Arc(x1, y0, r, -math.Pi/2, math.Pi/2, vector.Clockwise)
	p.Close()
	op := &vector.DrawPathOptions{AntiAlias: true}
	op.ColorScale.ScaleWithColor(c)
	vector.FillPath(dst, &p, nil, op)
}

// Halo néon : couches concentriques de plus en plus transparentes.
const glowLayers = 6

func glowAlpha(i int) float64 { return 0.07 * float64(glowLayers-i) / glowLayers }

func glowPill(dst *ebiten.Image, x, y, w, h float64, c color.NRGBA) {
	for i := glowLayers; i >= 1; i-- {
		e := float64(i) * 3
		pill(dst, x-e, y-e, w+2*e, h+2*e, withAlpha(c, glowAlpha(i-1)*1.6))
	}
	pill(dst, x, y, w, h, c)
}

func glowCircle(dst *ebiten.Image, x, y, r float64, c color.NRGBA, a float64) {
	for i := glowLayers; i >= 1; i-- {
		fillCircle(dst, x, y, r+float64(i)*2.5, withAlpha(c, glowAlpha(i-1)*1.6*a))
	}
	fillCircle(dst, x, y, r, withAlpha(c, a))
}

func glowStrokeRect(dst *ebiten.Image, x, y, w, h float64, c color.NRGBA) {
	for i := 4; i >= 1; i-- {
		e := float64(i) * 2
		strokeRect(dst, x, y, w, h, 3+2*e, withAlpha(c, 0.06))
	}
	strokeRect(dst, x, y, w, h, 3, c)
}

func (g *Game) face(bold bool, size float64) *text.GoTextFace {
	src := g.fontReg
	if bold {
		src = g.fontBold
	}
	return &text.GoTextFace{Source: src, Size: size * S}
}

// drawText centre le texte sur (x, y).
func drawText(dst *ebiten.Image, s string, f *text.GoTextFace, x, y float64, c color.Color) {
	op := &text.DrawOptions{}
	op.GeoM.Translate(x*S, y*S)
	op.ColorScale.ScaleWithColor(c)
	op.PrimaryAlign = text.AlignCenter
	op.SecondaryAlign = text.AlignCenter
	text.Draw(dst, s, f, op)
}

func drawGlowText(dst *ebiten.Image, s string, f *text.GoTextFace, x, y float64, c, glow color.NRGBA, radius float64) {
	for i := 0; i < 12; i++ {
		a := float64(i) * math.Pi / 6
		for _, r := range []float64{radius, radius / 2} {
			drawText(dst, s, f, x+math.Cos(a)*r, y+math.Sin(a)*r, withAlpha(glow, 0.07))
		}
	}
	drawText(dst, s, f, x, y, c)
}

func (g *Game) drawField(dst *ebiten.Image) {
	dst.Fill(colField)

	// Ligne médiane pointillée
	for x := 0.0; x < W; x += 34 {
		line(dst, x, H/2, math.Min(x+18, W), H/2, 4, withAlpha(colText, 0.25))
	}

	// Bordures néon (haut = joueur 1, bas = joueur 2)
	glowStrokeRect(dst, 1.5, 1.5, W-3, H/2-1.5, colP1)
	glowStrokeRect(dst, 1.5, H/2, W-3, H/2-1.5, colP2)
}

func (g *Game) drawScores(dst *ebiten.Image) {
	f := g.face(true, 96)
	drawGlowText(dst, fmt.Sprint(g.p1.score), f, W/2, H/4, withAlpha(colP1, 0.35), colP1, 6)
	drawGlowText(dst, fmt.Sprint(g.p2.score), f, W/2, H*3/4, withAlpha(colP2, 0.35), colP2, 6)
}

func (g *Game) drawRally(dst *ebiten.Image) {
	if g.state == stMenu || g.rally == 0 {
		return
	}
	s := fmt.Sprintf("échange %d", g.rally)
	f := g.face(false, 18)
	op := &text.DrawOptions{}
	op.GeoM.Translate((W-16)*S, (H/2-8)*S)
	op.ColorScale.ScaleWithColor(withAlpha(colText, 0.4))
	op.PrimaryAlign = text.AlignEnd
	op.SecondaryAlign = text.AlignEnd
	text.Draw(dst, s, f, op)
}

func (g *Game) drawPaddle(dst *ebiten.Image, p *paddle, sprite *layer) {
	img := sprite.get("pad", PaddleW+2*padMargin, PaddleH+2*padMargin, func(img *ebiten.Image) {
		glowPill(img, padMargin, padMargin, PaddleW, PaddleH, p.color)
	})
	blit(dst, img, p.x-padMargin, p.y-padMargin, ebiten.ColorScale{})
}

func (g *Game) drawBall(dst *ebiten.Image) {
	b := &g.ball
	trailColor := colP1
	if b.vy < 0 {
		trailColor = colP2
	}
	dot := g.dot.get("dot", 2*BallR+2, 2*BallR+2, func(img *ebiten.Image) {
		fillCircle(img, BallR+1, BallR+1, BallR, colWhite)
	})
	n := len(b.trail)
	for i, t := range b.trail {
		a := float64(i+1) / float64(n)
		op := &ebiten.DrawImageOptions{Filter: ebiten.FilterLinear}
		op.GeoM.Translate(-(BallR+1)*S, -(BallR+1)*S)
		op.GeoM.Scale(a, a)
		op.GeoM.Translate(t.x*S, t.y*S)
		op.ColorScale.ScaleWithColor(withAlpha(trailColor, a*0.35))
		dst.DrawImage(dot, op)
	}

	img := g.ballSprite.get("ball", 2*ballMargin, 2*ballMargin, func(img *ebiten.Image) {
		glowCircle(img, ballMargin, ballMargin, BallR, colWhite, 1)
	})
	var cs ebiten.ColorScale
	if g.state == stServe { // clignote pendant l'engagement
		cs.ScaleAlpha(float32(0.5 + 0.5*math.Sin(g.serveTimer*20)))
	}
	blit(dst, img, b.x-ballMargin, b.y-ballMargin, cs)
}

func (g *Game) drawServeArrow(dst *ebiten.Image) {
	if g.state != stServe && !(g.state == stPaused && g.pausedFrom == stServe) {
		return
	}
	c := colP1
	if g.serveDir > 0 {
		c = colP2
	}
	y := H/2 + g.serveDir*40
	for _, lw := range []float64{10, 4} {
		col := c
		if lw > 4 {
			col = withAlpha(c, 0.25)
		}
		line(dst, W/2-14, y-g.serveDir*10, W/2, y, lw, col)
		line(dst, W/2, y, W/2+14, y-g.serveDir*10, lw, col)
		fillCircle(dst, W/2, y, lw/2, col)
	}
}

func (g *Game) drawOverlay(dst *ebiten.Image) {
	fillRect(dst, 0, 0, W, H, withAlpha(colBg, 0.75))

	cy := H/2 - 190.0
	drawGlowText(dst, "P O N G", g.face(true, 88), W/2, cy, colWhite, colP2, 8)
	cy += 100

	msg, msgColor, stats := fmt.Sprintf("Premier à %d points", WinScore), colText, ""
	switch g.state {
	case stPaused:
		msg = "Pause — Espace / Échap / Entrée"
	case stOver:
		name := "Joueur 1"
		if g.winner == &g.p2 {
			name = "Joueur 2"
		}
		msg, msgColor = fmt.Sprintf("%s gagne %d – %d !", name, g.p1.score, g.p2.score), g.winner.color
		s := "s"
		if g.longestRally <= 1 {
			s = ""
		}
		stats = fmt.Sprintf("Plus long échange : %d renvoi%s", g.longestRally, s)
	}
	drawGlowText(dst, msg, g.face(true, 26), W/2, cy, msgColor, msgColor, 3)
	cy += 42
	if stats != "" {
		drawText(dst, stats, g.face(false, 20), W/2, cy, withAlpha(colText, 0.8))
		cy += 40
	}

	// Encadrés des commandes
	boxes := []struct {
		label, keys string
		c           color.NRGBA
	}{
		{"JOUEUR 1 · HAUT", "Q gauche   D droite", colP1},
		{"JOUEUR 2 · BAS", "4 gauche   6 droite (pavé num.)", colP2},
	}
	cy += 10
	for _, b := range boxes {
		bw, bh := 400.0, 74.0
		fillRect(dst, (W-bw)/2, cy, bw, bh, withAlpha(b.c, 0.08))
		glowStrokeRect(dst, (W-bw)/2, cy, bw, bh, b.c)
		drawText(dst, b.label, g.face(true, 18), W/2, cy+24, b.c)
		drawText(dst, b.keys, g.face(false, 17), W/2, cy+52, colText)
		cy += bh + 18
	}

	hint := "Entrée : jouer · Espace/Échap : pause"
	if g.state == stOver {
		hint = "Entrée : rejouer"
	}
	drawText(dst, hint, g.face(false, 17), W/2, cy+16, withAlpha(colText, 0.85))
	drawText(dst, "F11 : plein écran", g.face(false, 15), W/2, cy+44, withAlpha(colText, 0.55))
}

func (g *Game) Draw(screen *ebiten.Image) {
	sw, sh := float64(screen.Bounds().Dx()), float64(screen.Bounds().Dy())
	fill := FieldFill
	if ebiten.IsFullscreen() {
		fill = FieldFillFull
	}
	S = math.Min(sw*fill/W, sh*fill/H)

	// Terrain rendu directement à sa taille finale (recréé si la fenêtre change de taille)
	fw, fh := int(math.Ceil(W*S)), int(math.Ceil(H*S))
	if g.field == nil || g.field.Bounds().Dx() != fw || g.field.Bounds().Dy() != fh {
		if g.field != nil {
			g.field.Deallocate()
		}
		g.field = ebiten.NewImage(fw, fh)
	}
	f := g.field
	var none ebiten.ColorScale
	blit(f, g.bgLayer.get("bg", W, H, g.drawField), 0, 0, none)
	blit(f, g.scoreLayer.get(fmt.Sprint(g.p1.score, g.p2.score), W, H, g.drawScores), 0, 0, none)
	g.drawRally(f)
	g.drawPaddle(f, &g.p1, &g.pad1Sprite)
	g.drawPaddle(f, &g.p2, &g.pad2Sprite)
	g.drawServeArrow(f)
	if g.state != stMenu {
		g.drawBall(f)
	}
	if g.state == stMenu || g.state == stPaused || g.state == stOver {
		key := fmt.Sprint(g.state, g.p1.score, g.p2.score, g.longestRally)
		blit(f, g.overlayLayer.get(key, W, H, g.drawOverlay), 0, 0, none)
	}

	// Terrain centré dans la fenêtre
	screen.Fill(colBg)
	op := &ebiten.DrawImageOptions{}
	op.GeoM.Translate(math.Round((sw-float64(fw))/2), math.Round((sh-float64(fh))/2))
	screen.DrawImage(f, op)
}

func (g *Game) Layout(outsideWidth, outsideHeight int) (int, int) {
	s := ebiten.Monitor().DeviceScaleFactor()
	return int(float64(outsideWidth) * s), int(float64(outsideHeight) * s)
}

func main() {
	ebiten.SetWindowTitle("Pong Néon")
	// Fenêtre proportionnée à l'écran, au format du terrain (2:3)
	_, mh := ebiten.Monitor().Size()
	wh := int(float64(mh) * WindowFill)
	ebiten.SetWindowSize(wh*2/3, wh)
	ebiten.SetWindowSizeLimits(240, 360, -1, -1)
	ebiten.SetWindowResizingMode(ebiten.WindowResizingModeEnabled)
	ebiten.SetTPS(ebiten.SyncWithFPS)   // Update appelé une fois par image affichée
	ebiten.SetRunnableOnUnfocused(true) // pour détecter la perte de focus et mettre en pause
	if err := ebiten.RunGame(NewGame()); err != nil {
		log.Fatal(err)
	}
}
