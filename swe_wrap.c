/* swe_wrap.c
 *
 * Thin bridge between JavaScript and the Swiss Ephemeris C library.
 * Exposes a single one-shot computation used by the web app:
 *
 *   int chart_compute(int year, int month, int day, double hour_ut,
 *                     double geolat, double geolon, int use_swiss,
 *                     double *out, char *errbuf)
 *
 * Output layout (84 doubles):
 *   for body i in 0..11:
 *     out[6*i+0]  ecliptic longitude, degrees [0,360)
 *     out[6*i+1]  ecliptic latitude, degrees
 *     out[6*i+2]  distance, AU
 *     out[6*i+3]  speed in longitude, degrees/day (sign => direct/retrograde)
 *     out[6*i+4]  declination, degrees
 *     out[6*i+5]  apparent magnitude
 *   body order: Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn,
 *               Uranus, Neptune, Pluto, True Node, Mean Node
 *   (for the two nodes only out[6*i+0] is meaningful)
 *   out[72]  ascendant, degrees
 *   out[73]  midheaven (MC), degrees
 *   out[74..83] whole-sign house numbers (1..12) for bodies 0..9
 *
 * Returns 0 on success, -1 on error (message in errbuf, >=256 bytes).
 * The caller must have placed the required .se1 files into the
 * Emscripten virtual FS and called swe_set_ephe_path() beforehand
 * when use_swiss != 0. With use_swiss == 0 the built-in Moshier
 * ephemeris is used instead (no files needed, lower precision).
 */
#include <emscripten.h>
#include <math.h>
#include <string.h>

#include "swephexp.h"

#define NW 12
static const int body_ids[NW] = {
  SE_SUN, SE_MOON, SE_MERCURY, SE_VENUS, SE_MARS,
  SE_JUPITER, SE_SATURN, SE_URANUS, SE_NEPTUNE, SE_PLUTO,
  SE_TRUE_NODE, SE_MEAN_NODE
};

#define NOUT 84
#define ERRBUF_LEN 256

EMSCRIPTEN_KEEPALIVE
int chart_compute(int year, int month, int day, double hour_ut,
                  double geolat, double geolon, int use_swiss,
                  double *out, char *errbuf)
{
  int i, is_node;
  int32 ret;
  int gregflag;
  int32 iflag;
  double tjd_ut;
  double x[6], xe[6], attr[20];
  double cusps[13], ascmc[10];
  char serr[AS_MAXCH];

  serr[0] = '\0';

  /* Gregorian calendar from 1582-10-15, Julian before */
  if (year > 1582 ||
      (year == 1582 && (month > 10 || (month == 10 && day >= 15))))
    gregflag = SE_GREG_CAL;
  else
    gregflag = SE_JUL_CAL;

  iflag = (use_swiss ? SEFLG_SWIEPH : SEFLG_MOSEPH) | SEFLG_SPEED;

  tjd_ut = swe_julday(year, month, day, hour_ut, gregflag);

  for (i = 0; i < NW; i++) {
    double *o = out + 6 * i;
    is_node = (i >= 10);

    ret = swe_calc_ut(tjd_ut, body_ids[i], iflag, x, serr);
    if (ret == ERR) {
      strncpy(errbuf, serr, ERRBUF_LEN - 1);
      errbuf[ERRBUF_LEN - 1] = '\0';
      return -1;
    }
    o[0] = x[0];   /* ecliptic longitude */
    o[1] = x[1];   /* ecliptic latitude */
    o[2] = x[2];   /* distance AU */
    o[3] = x[3];   /* speed in longitude, deg/day */
    o[4] = NAN;
    o[5] = NAN;

    if (!is_node) {
      /* declination via equatorial coordinates */
      ret = swe_calc_ut(tjd_ut, body_ids[i], iflag | SEFLG_EQUATORIAL, xe, serr);
      if (ret == ERR) {
        strncpy(errbuf, serr, ERRBUF_LEN - 1);
        errbuf[ERRBUF_LEN - 1] = '\0';
        return -1;
      }
      o[4] = xe[1];

      /* apparent magnitude */
      ret = swe_pheno_ut(tjd_ut, body_ids[i], iflag, attr, serr);
      if (ret == ERR) {
        strncpy(errbuf, serr, ERRBUF_LEN - 1);
        errbuf[ERRBUF_LEN - 1] = '\0';
        return -1;
      }
      o[5] = attr[4];
    }
  }

  /* ascendant, MC and whole-sign houses (analytic: no ephemeris file needed) */
  ret = swe_houses(tjd_ut, geolat, geolon, 'W', cusps, ascmc);
  if (ret == ERR) {
    strncpy(errbuf, "swe_houses failed", ERRBUF_LEN - 1);
    errbuf[ERRBUF_LEN - 1] = '\0';
    return -1;
  }
  out[72] = ascmc[0];
  out[73] = ascmc[1];
  {
    int asc_sign = (int)(ascmc[0] / 30.0);
    for (i = 0; i < 10; i++) {
      int bsign = (int)(out[6 * i] / 30.0);
      out[74 + i] = (double)(((bsign - asc_sign + 12) % 12) + 1);
    }
  }

  return 0;
}

/* eclipse_at_syzygy(double tjd_ut, int is_full_moon, int use_swiss,
 *                   double *out, char *errbuf)
 *
 * Idiosyncratic check for the Aspects search: was the Sun-Moon syzygy at
 * tjd_ut (conjunction = new moon, opposition = full moon) an eclipse?
 *
 * out[0] = 1 if an eclipse, 0 if not
 * out[1] = SE_ECL_* type bitmask (if an eclipse)
 * out[2] = Julian day of maximum eclipse (if an eclipse)
 *
 * Method: swe_sol_eclipse_when_glob / swe_lun_eclipse_when find the next
 * global eclipse after tjd_ut - 2; it belongs to this syzygy iff its
 * maximum is within 3 days (syzygies are ~14.77 d apart; eclipse maxima
 * fall within ~1 d of syzygy). A cheap pre-filter skips the search when
 * the Moon's latitude at syzygy is >= 1.7 deg -- beyond every geometric
 * eclipse limit with margin (greatest eclipse is within ~0.01 d of
 * conjunction in longitude, so the latitude barely changes meanwhile).
 *
 * Returns 0 on success, -1 on error (message in errbuf, >=256 bytes).
 */
EMSCRIPTEN_KEEPALIVE
int eclipse_at_syzygy(double tjd_ut, int is_full_moon, int use_swiss,
                      double *out, char *errbuf)
{
  int32 ret;
  int32 iflag;
  double x[6];
  double tret[10];
  char serr[AS_MAXCH];

  serr[0] = '\0';
  iflag = (use_swiss ? SEFLG_SWIEPH : SEFLG_MOSEPH) | SEFLG_SPEED;

  out[0] = 0;
  out[1] = 0;
  out[2] = 0;

  /* cheap pre-filter: no eclipse possible at high lunar latitude */
  ret = swe_calc_ut(tjd_ut, SE_MOON, iflag, x, serr);
  if (ret == ERR) {
    strncpy(errbuf, serr, ERRBUF_LEN - 1);
    errbuf[ERRBUF_LEN - 1] = '\0';
    return -1;
  }
  if (fabs(x[1]) >= 1.7)
    return 0;

  if (is_full_moon)
    ret = swe_lun_eclipse_when(tjd_ut - 2.0, iflag, 0, tret, 0, serr);
  else
    ret = swe_sol_eclipse_when_glob(tjd_ut - 2.0, iflag, 0, tret, 0, serr);
  if (ret == ERR) {
    strncpy(errbuf, serr, ERRBUF_LEN - 1);
    errbuf[ERRBUF_LEN - 1] = '\0';
    return -1;
  }
  if (fabs(tret[0] - tjd_ut) <= 3.0) {
    out[0] = 1;
    out[1] = (double) ret;
    out[2] = tret[0];
  }
  return 0;
}
/* search_compute(double tjd_ut, int use_swiss, int body_mask,
 *                double *out, char *errbuf)
 *
 * Fast single-purpose entry point for the Aspects/Stations search tabs:
 * ecliptic longitude + longitude speed (deg/day) for a subset of bodies at
 * a Julian day, one swe_calc_ut call per requested body with SEFLG_SPEED.
 * No equatorial pass, no magnitudes, no houses.
 *
 * Body slots follow the chart_compute order: 0 Sun, 1 Moon, 2 Mercury,
 * 3 Venus, 4 Mars, 5 Jupiter, 6 Saturn, 7 Uranus, 8 Neptune, 9 Pluto,
 * 10 True Node. Bit i of body_mask selects slot i; for each selected slot,
 * out[2*i] = longitude (deg), out[2*i+1] = speed in longitude (deg/day).
 * Slots whose bit is clear are left untouched.
 *
 * Returns 0 on success, -1 on error (message in errbuf, >=256 bytes).
 */
EMSCRIPTEN_KEEPALIVE
int search_compute(double tjd_ut, int use_swiss, int body_mask,
                   double *out, char *errbuf)
{
  int i;
  int32 ret;
  int32 iflag;
  double x[6];
  char serr[AS_MAXCH];

  serr[0] = '\0';
  iflag = (use_swiss ? SEFLG_SWIEPH : SEFLG_MOSEPH) | SEFLG_SPEED;

  for (i = 0; i < 11; i++) {
    if (!(body_mask & (1 << i)))
      continue;
    ret = swe_calc_ut(tjd_ut, body_ids[i], iflag, x, serr);
    if (ret == ERR) {
      strncpy(errbuf, serr, ERRBUF_LEN - 1);
      errbuf[ERRBUF_LEN - 1] = '\0';
      return -1;
    }
    out[2 * i] = x[0];   /* ecliptic longitude */
    out[2 * i + 1] = x[3]; /* speed in longitude, deg/day */
  }

  return 0;
}
