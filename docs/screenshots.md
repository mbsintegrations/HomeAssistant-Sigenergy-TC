# Screenshot gallery

Example readings are illustrative and contain no private account/plant details. Desktop, tablet and phone layouts use the same bundled card. These screenshots show the 0.2.9 Beta frontend.

## Desktop

![Desktop overview](images/desktop-overview.png)

## Tablet

![Tablet overview](images/tablet-overview.png)

![Full dashboard embedded in a custom tablet shell](images/embedded-tablet.png)

Smaller landscape and portrait screens retain readable controls and allow vertical scrolling when needed.

<details><summary>Additional tablet layouts</summary>

![Smaller tablet landscape](images/tablet-landscape.png)

![Tablet portrait](images/tablet-portrait.png)

</details>

## Phone

<img alt="Phone overview" src="images/phone-overview.png" width="412">

## Charts and controls

![Charts](images/charts.png)

![Manual battery control popup](images/manual-control.png)

![AC PV Surplus start and temporary Fast Charging choices](images/ac-temporary-fast.png)

To check the documentation examples in a local Chrome installation, install Playwright (`npm install --no-save playwright`) and run `node tools/check_layout.cjs`. The check tests widget containment, ring overlap, forecast headings and horizontal overflow at five desktop/tablet/phone viewport sizes, then refreshes the overview screenshots. These are CSS viewport sizes; the tablet and phone cases also cover higher display pixel density.

## Native configuration

![Native Personal Strategies](images/native-strategies.png)

![Native tariff plan](images/native-tariffs.png)

## Native strategy controls

[Create, change, rename and delete native strategies](native-strategies.md). Public screenshots use synthetic data.

![Desktop native strategy editor](images/native-strategy-editor.png)

<img alt="Phone native strategy editor" src="images/phone-strategy-editor.png" width="412">
