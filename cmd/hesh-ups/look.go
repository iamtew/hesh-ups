package main

import (
	"encoding/json"
	"regexp"
	"strings"
)

var hexColorRe = regexp.MustCompile(`^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)

type Look struct {
	FontSize   int    `json:"font_size"`
	FontWeight int    `json:"font_weight"`
	Fill       string `json:"fill"`
	Stroke     string `json:"stroke"`
	StrokeW    int    `json:"stroke_w"`
	Align      string `json:"align"`
	Fit        string `json:"fit"`
	Motion     string `json:"motion"`
}

func defaultLook() Look {
	return Look{
		FontSize: 24, FontWeight: 600,
		Fill: "#ffffff", Stroke: "#111111", StrokeW: 3,
		Align: "center", Fit: "shrink", Motion: "fade",
	}
}

func (l *Look) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		*l = defaultLook()
		return nil
	}
	var r struct {
		FontSize   int    `json:"font_size"`
		FontWeight int    `json:"font_weight"`
		Fill       string `json:"fill"`
		Stroke     string `json:"stroke"`
		StrokeW    *int   `json:"stroke_w"`
		Align      string `json:"align"`
		Fit        string `json:"fit"`
		Motion     string `json:"motion"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return err
	}
	sw := 3
	if r.StrokeW != nil {
		sw = *r.StrokeW
	}
	*l = Look{r.FontSize, r.FontWeight, r.Fill, r.Stroke, sw, r.Align, r.Fit, r.Motion}.norm()
	return nil
}

func (l Look) empty() bool {
	return l.FontSize == 0 && l.FontWeight == 0 && l.Fill == "" && l.Stroke == "" &&
		l.StrokeW == 0 && l.Align == "" && l.Fit == "" && l.Motion == ""
}

func (l Look) norm() Look {
	d := defaultLook()
	if l.FontSize == 0 && l.FontWeight == 0 && l.Fill == "" && l.Stroke == "" &&
		l.Align == "" && l.Fit == "" && l.Motion == "" && l.StrokeW == 0 {
		return d
	}
	if l.FontSize > 0 {
		d.FontSize = l.FontSize
	}
	if d.FontSize > 400 {
		d.FontSize = 400
	}
	if l.FontWeight > 0 {
		d.FontWeight = l.FontWeight
	}
	if l.Fill != "" {
		d.Fill = strings.ToLower(l.Fill)
	}
	if l.Stroke != "" {
		d.Stroke = strings.ToLower(l.Stroke)
	}
	// UnmarshalJSON already applied default 3 when the key was omitted.
	d.StrokeW = l.StrokeW
	if d.StrokeW < 0 {
		d.StrokeW = 0
	}
	if d.StrokeW > 20 {
		d.StrokeW = 20
	}
	if l.Align != "" {
		d.Align = l.Align
	}
	if l.Fit != "" {
		d.Fit = l.Fit
	}
	if l.Motion != "" {
		d.Motion = l.Motion
	}
	return d
}

func validLook(l Look) (errKey, msg string) {
	l = l.norm()
	if !hexColorRe.MatchString(l.Fill) || !hexColorRe.MatchString(l.Stroke) {
		return "invalid_slot", "invalid look color"
	}
	switch l.Align {
	case "left", "center", "right":
	default:
		return "invalid_slot", "invalid look align"
	}
	switch l.Fit {
	case "shrink", "wrap", "ellipsis":
	default:
		return "invalid_slot", "invalid look fit"
	}
	switch l.Motion {
	case "fade", "slide", "scale":
	default:
		return "invalid_slot", "invalid look motion"
	}
	switch l.FontWeight {
	case 400, 600, 700:
	default:
		return "invalid_slot", "invalid look weight"
	}
	return "", ""
}

func encodeLook(l Look) string {
	b, _ := json.Marshal(l.norm())
	return string(b)
}

func decodeLook(s string) Look {
	if s == "" {
		return defaultLook()
	}
	var l Look
	if json.Unmarshal([]byte(s), &l) != nil {
		return defaultLook()
	}
	return l.norm()
}
