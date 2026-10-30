# Optional optimizer monitoring

Status: data model implemented; provider transport and HA panel entities are not implemented.

## What must be established

1. Exact optimizer model and number of monitored modules, including whether deployment covers all panels or selected shaded panels only.
2. Whether a Tigo Access Point (TAP) and Cloud Connect Advanced (CCA) are installed, commissioned and linked to the owner account.
3. Whether module readings appear in Tigo Energy Intelligence, with a stable module identity, array mapping and update timestamp.
4. Which supported local or account API exposes those readings, or which existing HA integration can supply them reliably.
5. Available fields, source units, cadence, retention, rate limits and any paid access requirements. These are not assumed from hardware marketing.

## Architecture

Keep module telemetry separate from Sigenergy string/MPPT telemetry. A string measurement cannot identify each module's production. No optimizer polling is added to the SigenStor connection without a verified device register specification.

`core/optimizers.py` represents provider identity, module identity, observation time, power W, voltage V, current A and energy kWh. Fields may be unknown. Validate units before normalization, reject invalid values and mark stale data unavailable. Do not represent missing modules as zero production.

The first provider should consume cached entities from a suitable installed HA integration if possible. Otherwise evaluate a documented local interface before an optional cloud API. Cloud credentials and source selection must be explicitly configured. Do not invent a direct Tigo Modbus interface or extract browser session tokens.

A future UI should explain missing prerequisites, discover the available modules, permit friendly panel names and positions, and show source/update health. Additional optimizer brands should implement the same telemetry contract only after their capabilities are verified.

Monitoring will not control optimizer rapid shutdown, bypass settings, firmware, commissioning or safety behavior. Optimizer hardware performs optimization itself; the HA feature observes its measurements.

## Vendor evidence

- [Tigo optimizer FAQ](https://support.tigoenergy.com/hc/en-us/articles/35838437199507-FAQ-Optimizers-TS4-O): optimization can operate without monitoring hardware; monitoring uses TAP and CCA.
- [Tigo TAP](https://www.tigoenergy.com/product/tigo-access-point): wireless link from supported TS4 modules, paired with a CCA for module monitoring.
- [Tigo CCA](https://www.tigoenergy.com/product/cloud-connect-advanced): module monitoring data hub and Energy Intelligence access.

These establish the hardware data path, not an approved HA API, an existing SigenStor register mapping or an implemented driver.
