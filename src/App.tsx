/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import SenecaHandsFree from "./components/SenecaHandsFree";
import VoiceCalibrationModal from "./components/VoiceCalibrationModal";
import { VOICE_OPEN_CALIBRATION_EVENT } from "./lib/voiceSettings";

export default function App() {
  const [calibOpen, setCalibOpen] = useState(false);

  useEffect(() => {
    const onVoiceCalib = (e: Event) => {
      const detail = (e as CustomEvent<{ open?: boolean }>).detail;
      setCalibOpen(detail?.open !== false);
    };
    window.addEventListener(VOICE_OPEN_CALIBRATION_EVENT, onVoiceCalib);
    return () => {
      window.removeEventListener(VOICE_OPEN_CALIBRATION_EVENT, onVoiceCalib);
    };
  }, []);

  useEffect(() => {
    const win = window as unknown as { __senecaEngineLoaded?: boolean };
    if (win.__senecaEngineLoaded) return;
    win.__senecaEngineLoaded = true;
    const script = document.createElement("script");
    script.src = "/seneca-engine.js";
    script.async = false;
    document.body.appendChild(script);
  }, []);

  return (
    <>
      <main>
        <header className="top">
          <div>
            <h1>Seneca</h1>
          </div>
          <div className="sync-wrap">
            <button
              type="button"
              className="savebtn"
              id="syncMenuBtn"
              aria-expanded="false"
              aria-haspopup="menu"
            >
              Sync ▾
            </button>
            <div className="sync-menu" id="syncMenu" role="menu" hidden>
              <button type="button" className="sync-item" id="syncSupaNowBtn" role="menuitem">
                <span>Cloud Sync (Supabase)</span>
                <small id="syncSupaState">Sign in</small>
              </button>
              <button type="button" className="sync-item" id="syncSupaCfgBtn" role="menuitem">
                <span>Supabase Account…</span>
                <small>Login / Setup</small>
              </button>
              <div className="sync-sep" />
              <button type="button" className="sync-item" id="syncGistNowBtn" role="menuitem">
                <span>Cloud Sync (Gist)</span>
                <small id="syncGistState">Not set</small>
              </button>
              <button type="button" className="sync-item" id="syncGistCfgBtn" role="menuitem">
                <span>Gist Sync settings…</span>
                <small>Token</small>
              </button>
              <div className="sync-sep" />
              <button type="button" className="sync-item" id="saveHtmlBtn" role="menuitem">
                <span>Link local file</span>
                <small id="syncLinkState">Auto-save</small>
              </button>
              <button type="button" className="sync-item" id="syncNowBtn" role="menuitem">
                <span>Save local file now</span>
                <small>Flush</small>
              </button>
              <div className="sync-sep" />
              <button type="button" className="sync-item" id="syncExportBtn" role="menuitem">
                <span>Download snapshot (.html)</span>
                <small>Shareable</small>
              </button>
              <button type="button" className="sync-item" id="syncImportBtn" role="menuitem">
                <span>Import progress…</span>
                <small>.html / .json</small>
              </button>
              <input type="file" id="syncImportFile" accept=".html,.htm,.json" hidden />
            </div>
          </div>
          <button type="button" className="stoic-rq" id="stoicRq" data-revqueue="1">
            Revision queue
          </button>
          <div className="themeseg" id="themeSwitch" role="group" aria-label="Theme">
            <button type="button" data-settheme="light" aria-pressed="true">
              Light
            </button>
            <button type="button" data-settheme="dark" aria-pressed="false">
              Dark
            </button>
            <button type="button" data-settheme="stoic" aria-pressed="false">
              Alternate
            </button>
          </div>
        </header>

        <section className="studybar" data-superof="stoa" aria-label="Syllabus completion">
          <div className="overall">
            <div className="big" id="overallPct">
              0%
            </div>
            <div className="overall-side">
              <div className="meter" aria-hidden="true">
                <i id="overallBar" />
              </div>
              <small id="overallText">Loading syllabus…</small>
            </div>
          </div>
        </section>

        <nav className="viewnav" id="viewnav" data-superof="stoa" aria-label="Views">
          <button type="button" className="vbtn" data-view="plan" aria-pressed="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="square"
              strokeLinejoin="miter"
              aria-hidden="true"
            >
              <path d="M3 10.5L12 3l9 7.5" />
              <path d="M5 9.5V20h14V9.5" />
            </svg>
            <span>Home</span>
          </button>
          <button type="button" className="vbtn" data-view="schedule" aria-pressed="false">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="square"
              strokeLinejoin="miter"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="8" />
              <path d="M12 7v5l3.5 2" />
            </svg>
            <span>Schedule</span>
          </button>
          <button type="button" className="vbtn" data-view="tracker" aria-pressed="false">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="square"
              strokeLinejoin="miter"
              aria-hidden="true"
            >
              <path d="M4 19h16M6 19V8M10 19V8M14 19V8M18 19V8M4 8l8-4 8 4" />
            </svg>
            <span>Syllabus</span>
          </button>
          <button type="button" className="vbtn" data-view="test" aria-pressed="false">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="square"
              strokeLinejoin="miter"
              aria-hidden="true"
            >
              <path d="M12 4v16M7 20h10M5 8h14M5 8l-2 5h4l-2-5M19 8l-2 5h4l-2-5" />
            </svg>
            <span>Tests</span>
          </button>
        </nav>

        <aside className="stoic-cov" id="stoicCov" aria-label="Subject coverage" />

        <div className="view" id="viewTracker" data-superof="stoa" hidden>
          <nav className="tabs" id="tabs" role="tablist" aria-label="Subjects" />

          <section className="panel" id="panel" data-subject="chemistry">
            <div className="toolbar">
              <div className="chips" id="chips" role="group" aria-label="Filter chapters" />
              <input
                id="chSearch"
                className="chsearch"
                type="search"
                placeholder="Search chapters ( / )"
                aria-label="Search chapters"
              />
              <div className="chips">
                <button className="add-btn" id="addBtn" type="button">
                  + Add source
                </button>
                <button
                  className="mini-btn"
                  id="mgrBtn"
                  type="button"
                  data-mgrtoggle="1"
                  title="Edit sources"
                >
                  ⚙ Sources
                </button>
                <button
                  className="add-btn"
                  id="qlFullBtn"
                  type="button"
                  title="Open the whole question log: due today, test prep, time stats"
                >
                  Question log
                </button>
              </div>
            </div>
            <form className="add-form" id="addForm" hidden>
              <input
                id="addInput"
                type="text"
                maxLength={24}
                placeholder="New source, e.g. Allen modules"
                aria-label="New source name"
                autoComplete="off"
              />
              <button className="go" type="submit">
                Add
              </button>
              <button type="button" id="addCancel">
                Cancel
              </button>
              <p className="hint">
                A new column is added to every chapter in this subject and counts toward progress
                right away.
              </p>
            </form>
            <div className="picker" id="srcMgr" hidden />
            <div className="scroll" id="grid" />
            <p className="plan" id="plan" />
          </section>

          <section className="card" id="deadline" aria-label="Syllabus deadline">
            <div>
              <p className="eyebrow">Syllabus deadline</p>
              <p className="dl-days">
                <b id="dlDays">96</b> <span>days left until</span>{" "}
                <label className="dl-date">
                  <span className="sr">Deadline date</span>
                  <input type="date" id="dlInput" />
                </label>
              </p>
            </div>
            <dl className="dl-stats">
              <div>
                <dt>Points</dt>
                <dd id="dlPoints">0/1,000</dd>
              </div>
              <div>
                <dt>Required rate</dt>
                <dd id="dlNeed">0</dd>
              </div>
              <div>
                <dt>Current rate</dt>
                <dd id="dlPace">0</dd>
              </div>
            </dl>
            <p className="dl-status" id="dlStatus" />
            <div id="dlChart" />
            <button className="pill" id="dlApply" type="button" data-resetgoal="1" hidden />
            <p className="note" id="dlTests" />
          </section>

          <section className="card today" id="today" aria-label="The last fourteen days">
            <p className="eyebrow">The last fourteen days</p>
            <div className="today-head">
              <div>
                <p className="eyebrow" id="todayDate" />
                <p className="line">
                  <b id="todayPts">0</b> <span>of</span>{" "}
                  <span className="stepper">
                    <button type="button" data-goal="-1" aria-label="Lower daily goal">
                      −
                    </button>
                    <b id="goalVal">10</b>
                    <button type="button" data-goal="1" aria-label="Raise daily goal">
                      +
                    </button>
                  </span>{" "}
                  <span>points today</span>
                </p>
              </div>
              <p className="streak" id="streak" />
            </div>
            <div className="meter" aria-hidden="true">
              <i id="todayBar" />
            </div>
            <p className="note" id="todayMsg" />
            <div>
              <div className="plot" id="plot" />
              <div className="axis" id="axis" />
            </div>
            <p className="note">
              Points over the last 14 days. The dashed line is your daily goal. Hover over a day to
              see what you ticked.
            </p>
            <ul className="today-list" id="todayList" />
          </section>
        </div>

        <div className="view" id="viewPlan" data-superof="stoa">
          <div className="td-layout">
            <div className="td-main">
              <section className="card seneca" id="seneca" aria-label="Seneca" />
            </div>
          </div>
        </div>

        <div className="view" id="viewSchedule" data-superof="stoa" hidden>
          <div className="sched-layout">
            <section className="card" id="planTimeline" />
          </div>
        </div>

        <div className="view" id="viewTest" data-superof="stoa" hidden>
          <section className="card" id="tpPlan" />
          <section className="card" id="tpProgress" />
          <div className="view" id="tpBuild" />
        </div>

        <div className="backup-foot">
          <button type="button" className="linkbtn" id="exportHtmlBtn">
            Export HTML (with data)
          </button>
          <button type="button" className="linkbtn" id="exportJsonBtn">
            Export JSON backup
          </button>
          <label className="linkbtn" htmlFor="importJsonInput" style={{ cursor: "pointer" }}>
            Import JSON backup
            <input id="importJsonInput" type="file" accept="application/json,.json" hidden />
          </label>
          <button
            type="button"
            className="linkbtn"
            id="voiceCalibBtn"
            onClick={() => setCalibOpen(true)}
          >
            Voice &amp; mic calibration
          </button>
        </div>
      </main>
      <div className="toast" id="toast" role="status" hidden />
      <SenecaHandsFree />
      <VoiceCalibrationModal open={calibOpen} onClose={() => setCalibOpen(false)} />
    </>
  );
}
