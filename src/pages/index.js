import {useState} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './index.module.css';

function HeroSearchBar() {
  const [query, setQuery] = useState('');
  const searchUrl = useBaseUrl('/search');

  function handleSearch(e) {
    e.preventDefault();
    if (query.trim()) {
      window.location.href = `${searchUrl}?q=${encodeURIComponent(query.trim())}`;
    }
  }

  return (
    <form className={styles.searchForm} onSubmit={handleSearch}>
      <input
        className={styles.searchInput}
        type="search"
        placeholder="Søg i vejledninger..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Søg i vejledninger"
      />
      <button className={styles.searchButton} type="submit" aria-label="Søg">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
    </form>
  );
}

function HeroBanner() {
  return (
    <header className={styles.heroBanner}>
      <div className={styles.heroOverlay} />
      <div className={styles.heroContent}>
        <Heading as="h1" className={styles.heroTitle}>
          Hvad leder du efter?
        </Heading>
        <HeroSearchBar />
        <p className={styles.heroSubtitle}>
          Vejledninger til KMD Supplier Overview
        </p>
      </div>
    </header>
  );
}

function InfoSection() {
  return (
    <section className={styles.infoSection}>
      <div className="container">
        <div className={styles.infoCard}>
          <Heading as="h2" className={styles.infoHeading}>
            Her finder du vejledninger til KMD Supplier Overview
          </Heading>
          <p>
            Velkommen til online-brugervejledninger for KMD Supplier Overview.
            <br />
            Du kan finde det, du søger på flere måder:
          </p>
          <ul className={styles.tipsList}>
            <li>Brug menuen til at navigere mellem vejledninger</li>
            <li>
              Søg direkte i søgefeltet – både fra forsiden og inde i en
              vejledning
              <ul>
                <li>Husk der søges på tværs af alle vejledninger</li>
              </ul>
            </li>
          </ul>
          <div className={styles.tipBox}>
            <strong>Tip:</strong>
            <ul className={styles.tipsList}>
              <li>
                Er der dele af vejledningen, som du ofte vender tilbage til, kan
                du med fordel gemme URL'en som en favorit i din browser.
              </li>
              <li>
                Fandt du ikke det, du søgte? Prøv at sætte en{' '}
                <code>*</code> foran og/eller bag dit søgeord – det gør
                søgningen bredere.
              </li>
            </ul>
          </div>
          <div className={styles.ctaButtons}>
            <Link
              className="button button--primary button--lg"
              to="/docs/category/intro-til-supplier-overview">
              Kom i gang
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <HeroBanner />
      <main>
        <InfoSection />
      </main>
    </Layout>
  );
}
