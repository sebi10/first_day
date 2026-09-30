// Palette from the spec. Rust is the only alert hue: nothing else may use it.
export const C = {
  sand: '#F2E3C6',
  sandDeep: '#E6D0A6',
  sea: '#2E7C93',
  seaDeep: '#1F5E72',
  seaLight: '#5FA3B5',
  palm: '#4E8A5A',
  palmDark: '#3A6B45',
  rust: '#C7502F',
  ink: '#1F2A30',
  inkSoft: '#56646B',
  paper: '#FBF5E9',
  white: '#FFFFFF',
  mech: '#E0A458',
  elec: '#F4D35E',
  fin: '#8FB8DE',
} as const;

export const ROLE_TINT = { mech: C.mech, elec: C.elec, fin: C.fin } as const;

export const FONT = `'Manrope', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
