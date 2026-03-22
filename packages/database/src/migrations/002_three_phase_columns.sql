-- ══════════════════════════════════════════════════════════════
-- Migration: 002_three_phase_columns.sql
-- Description: Add 3-phase power monitoring columns to power_readings
-- Date: 2026-03-22
-- ══════════════════════════════════════════════════════════════

-- Add per-phase voltage columns
ALTER TABLE power_readings
  ADD COLUMN IF NOT EXISTS voltage_a NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS voltage_b NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS voltage_c NUMERIC(6,2);

-- Add per-phase current columns
ALTER TABLE power_readings
  ADD COLUMN IF NOT EXISTS current_a NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS current_b NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS current_c NUMERIC(6,3);

-- Add per-phase power columns
ALTER TABLE power_readings
  ADD COLUMN IF NOT EXISTS power_a NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS power_b NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS power_c NUMERIC(8,2);

-- Add per-phase energy columns
ALTER TABLE power_readings
  ADD COLUMN IF NOT EXISTS energy_a NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS energy_b NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS energy_c NUMERIC(10,4);

-- Add per-phase frequency columns
ALTER TABLE power_readings
  ADD COLUMN IF NOT EXISTS frequency_a NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS frequency_b NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS frequency_c NUMERIC(5,2);

-- Add per-phase power factor columns
ALTER TABLE power_readings
  ADD COLUMN IF NOT EXISTS power_factor_a NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS power_factor_b NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS power_factor_c NUMERIC(4,3);

-- Add total columns (calculated from phase sums)
ALTER TABLE power_readings
  ADD COLUMN IF NOT EXISTS total_power NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS total_energy NUMERIC(12,4);

-- Update table comment
COMMENT ON TABLE power_readings IS 'Append-only power readings. Supports both single-phase (legacy) and 3-phase monitoring.';

-- Column comments for documentation
COMMENT ON COLUMN power_readings.voltage_a IS 'Phase A voltage (V)';
COMMENT ON COLUMN power_readings.voltage_b IS 'Phase B voltage (V)';
COMMENT ON COLUMN power_readings.voltage_c IS 'Phase C voltage (V)';
COMMENT ON COLUMN power_readings.current_a IS 'Phase A current (A)';
COMMENT ON COLUMN power_readings.current_b IS 'Phase B current (A)';
COMMENT ON COLUMN power_readings.current_c IS 'Phase C current (A)';
COMMENT ON COLUMN power_readings.power_a IS 'Phase A power (W)';
COMMENT ON COLUMN power_readings.power_b IS 'Phase B power (W)';
COMMENT ON COLUMN power_readings.power_c IS 'Phase C power (W)';
COMMENT ON COLUMN power_readings.energy_a IS 'Phase A cumulative energy (kWh)';
COMMENT ON COLUMN power_readings.energy_b IS 'Phase B cumulative energy (kWh)';
COMMENT ON COLUMN power_readings.energy_c IS 'Phase C cumulative energy (kWh)';
COMMENT ON COLUMN power_readings.frequency_a IS 'Phase A frequency (Hz)';
COMMENT ON COLUMN power_readings.frequency_b IS 'Phase B frequency (Hz)';
COMMENT ON COLUMN power_readings.frequency_c IS 'Phase C frequency (Hz)';
COMMENT ON COLUMN power_readings.power_factor_a IS 'Phase A power factor (0-1)';
COMMENT ON COLUMN power_readings.power_factor_b IS 'Phase B power factor (0-1)';
COMMENT ON COLUMN power_readings.power_factor_c IS 'Phase C power factor (0-1)';
COMMENT ON COLUMN power_readings.total_power IS 'Sum of power across all phases (W)';
COMMENT ON COLUMN power_readings.total_energy IS 'Sum of energy across all phases (kWh)';
