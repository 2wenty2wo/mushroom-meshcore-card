---
layout: home

hero:
  name: Mushroom MeshCore Card
  text: Four cards, each with one job
  tagline: Monitor a hub or node, follow a channel, collect mentions, and track software releases in Home Assistant.
  image:
    src: /logo.svg
    alt: Mushroom MeshCore Card logo
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Explore the cards
      link: "#cards"
    - theme: alt
      text: GitHub
      link: https://github.com/2wenty2wo/mushroom-meshcore-card
---

<section id="cards" class="mmc-home-cards" aria-labelledby="mmc-home-cards-heading">
  <div class="mmc-home-cards__intro">
    <h2 id="mmc-home-cards-heading">See the cards</h2>
    <p>Real card views in light and dark Home Assistant themes. Supporting device data is discovered automatically wherever possible, and Mushroom and Card Mod remain optional.</p>
  </div>
  <div class="mmc-home-cards__gallery">
    <a class="mmc-home-preview mmc-home-preview--main" href="./cards/main.html">
      <img src="../screenshots/main-card.png" alt="Main card shown in dark and light Home Assistant themes">
      <span class="mmc-home-preview__copy">
        <span class="mmc-home-preview__heading">
          <strong>Main card</strong>
          <span>View guide →</span>
        </span>
        <span class="mmc-home-preview__description">Status and available telemetry for one selected hub or remote node.</span>
      </span>
    </a>
    <div class="mmc-home-cards__lower">
      <a class="mmc-home-preview" href="./cards/channel.html">
        <img src="../screenshots/channel-card.png" alt="Channel card conversations shown in dark and light Home Assistant themes" loading="lazy">
        <span class="mmc-home-preview__copy">
          <span class="mmc-home-preview__heading">
            <strong>Channel card</strong>
            <span>View guide →</span>
          </span>
          <span class="mmc-home-preview__description">Recent messages from one MeshCore channel, with route context when available.</span>
        </span>
      </a>
      <div class="mmc-home-cards__stack">
        <a class="mmc-home-preview" href="./cards/mentions.html">
          <img src="../screenshots/mentions-card.png" alt="Mentions card shown in dark and light Home Assistant themes" loading="lazy">
          <span class="mmc-home-preview__copy">
            <span class="mmc-home-preview__heading">
              <strong>Mentions card</strong>
              <span>View guide →</span>
            </span>
            <span class="mmc-home-preview__description">A dated To-do inbox for messages that tag you.</span>
          </span>
        </a>
        <a class="mmc-home-preview" href="./cards/releases.html">
          <img src="../screenshots/releases-card.png" alt="Releases card shown in dark and light Home Assistant themes" loading="lazy">
          <span class="mmc-home-preview__copy">
            <span class="mmc-home-preview__heading">
              <strong>Releases card</strong>
              <span>View guide →</span>
            </span>
            <span class="mmc-home-preview__description">Versions and published dates from the release sensors you choose.</span>
          </span>
        </a>
      </div>
    </div>
  </div>
</section>
