// fetchDatasets.js - module to return an array of mission datasets based on args.
//   1. If args.catalog is defined, load datasets from data/<catalog>, else...
//   2. If args.mission is defined, load data/<mission>/dataset.json, else...
//   3. Load all missions under data/*/dataset.json
//
// In all cases, JSON may be a single dict or an array of dicts.
// This function ALWAYS returns an array of dictionaries.

const fs = require('fs');
const path = require('path');

function toArray(x) {
    if (x == null) return [];
    return Array.isArray(x) ? x : [x];
}

function fetchDatasets(args) {
    let fileText;

    // Base data directory (resolved reliably)
    const dataDir = path.join(__dirname, '..', 'data');

    // 1. Catalog file if provided (relative to dataDir)
    if (args.catalog) {
        const catalogPath = path.join(dataDir, args.catalog);
        try {
            fileText = fs.readFileSync(catalogPath, 'utf-8');
            const parsed = JSON.parse(fileText);
            return toArray(parsed);      // normalize to array
        } catch (err) {
            console.error(err.message);
            return [];                   // always return an array
        }
    }

    // 2. Specific mission
    if (args.mission) {
        const datasetFile = path.join(dataDir, args.mission, 'dataset.json');
        if (!fs.existsSync(datasetFile)) {
            console.error(`Dataset file not found for mission: ${args.mission}`);
            return [];
        }
        try {
            fileText = fs.readFileSync(datasetFile, 'utf-8');
            const parsed = JSON.parse(fileText);
            return toArray(parsed);      // normalize to array
        } catch (err) {
            console.error(err.message);
            return [];
        }
    }

    // 3. Load all missions under data/
    let datasets = [];
    let missionDirs;
    try {
        missionDirs = fs
            .readdirSync(dataDir)
            .filter(entry => fs.statSync(path.join(dataDir, entry)).isDirectory());
    } catch (err) {
        console.error(err.message);
        return [];
    }

    missionDirs.forEach(mission => {
        const datasetFile = path.join(dataDir, mission, 'dataset.json');

        if (!fs.existsSync(datasetFile)) 
            return;  // Skip folders missing dataset.json silently

        try {
            fileText = fs.readFileSync(datasetFile, 'utf-8');
            const parsed = JSON.parse(fileText);
            const missionDatasets = toArray(parsed);   // normalize to array
            datasets.push(...missionDatasets);         // flatten
        } catch (err) {
            console.error(err.message);
        }
    });

    // Sort by priority (ascending) if present
    datasets.sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity));

    return datasets;
}

module.exports = fetchDatasets;
