# Comet.Photos (v2) Preprocessing Steps

We preprocess a great amount of data to speed up comet.photos during runtime, and produce the data files used by comet.photos. Here we document the steps used to preprocess data for comet.photos v2. Note that regular users do not need to concern themselves with this information - this documents how our dataset (the contents of the data directory) was prepared.

Preprocessing is done in two phases. We start with a folder of ESA Rosetta OSIRIS PDS3 .IMG files. In the first phase, we create .jpg files from the .IMG files and gather the initial image metadata used by comet.photos from these .IMG files and by computations using the SPICE kernels for the Rosetta mission.

### Preprocessing Phase 1

We start with a complex tree of ESA Rosetta OSIRIS PDS3 .IMG
files, under an OSINAC directory.

1. organize_imgs.py - creates a tree of .IMG files that are links to the .IMG files in the complex OSINAC tree, but more clearly organized. The files are placed in subdirectories of the form YYMM, where YY are the last two digits of the year of the image, and MM is the two digit month. This simple organization helps immensely. All processing of the .IMG files then uses this new folder structure.

2. pds_to_cubs.py - Converts ESA Rosetta OSIRIS PDS3 .IMG files to .CUB files using the USGS tools.

3. generate_pngs.py - extracts .png files from all the .CUB files, using the USGS tools.

4. pngs_to_jpgs.py - walks the PNG tree of images to generate .jpg files for each image.

5. json_from_imgs_directly.py - creates the phase 1 version of the
metadata file, imageMetadata_phase1.json, by traversing the .IMG files, and extracting from them: the basename ('nm'), time taken ('ti'), image resolution ('rz'). Then we use the SPICE kernel calculations to add the camera vector ('cv'), camera up vector ('up'), spacecraft position ('sc') and Sun position ('su').

### Preprocessing Phase 2

Additional visibility/spatial information is generated in phase 2 of preprocessing. This is done by using the imageMetadata_phase1.json file generated in Phase 1 as the input metadata file to the Comet.Photos server (cometserver.js), while the environmental variable "PREPROCESSING" is set to be true. The cometserver will open up a window, do visibility processing on all of the images, and create a new, complete imageMetadata_phase2.json file and visTableV2.0.bin.new in the server directory. Those two files are then renamed (imageMetaDataNAC.json and visTableNAC.bin) and moved to the data folder for comet.photos searches. Preprocessing is now complete.





