# Comet.Photos

Comet.Photos allows for fast spatial search of images from the Rosetta comet mission, specifically images from Osiris' Narrow Angle Camera, which provide the most detailed images of Comet 67P. Users of Comet.Photos can paint a region of interest on a 3D model of the comet, optionally specifying various lighting / geometry parameters, and in a fraction of a second, all matching images are found and made available for browsing, either projected onto the comet 3D shape model, or in their original 2D form.

There are two different usage options for Comet.Photos. People who expect to make frequent use of the software for their research are encouraged to install the program locally on their computer for best performance, with seemingly instantaneous feedback. However, people casually interested in trying out Comet.Photos can access the latest version at https://comet.photos to take it out for a spin. 

## Table of contents

* [Installation](#installion)
* [Motivation](#motivation)
* [User Manual](#user-manual)
* [Step-by-Step Example](#step-by-step-example)
* [Architecture](#architecture)
* [Performance](#performance)
* [Acknowledgments](#acknowledgments)
* [How to Report Issues](#how-to-report-issues)

## Installation

People wanting to try out Comet.Photos can simply run it in a web browser by visiting https://comet.photos. However, we suggest that scientists who expect to make frequent use of Comet.Photos should install it locally on their computer (Windows, Mac, or Linux) for the fastest, best experience. Installing Comet.Photos locally does require about 14GB of disk space (and an addition 14GB during the install process, which is freed up afterwards), mostly for the comet image files, but when the image files are local, it feels like all operations are instantaneous.

There are two ways to install Comet.Photos locally: from a tar archive, or from github. Installing from the tar archive is easiest, while installing from github may be preferable for people hoping to contribute to the project.

### Installation from a tar file (easiest)

1. Install Node.js.

Node.js is a popular JavaScript runtime required by Comet.Photos, which can be downloaded from https://nodejs.org/. You can simply install the LTS version from the home page, and if prompted, there is no need to install any extras.

2. Download and unpack the Comet.Photos release

Download the packaged comet.photos runtime by clicking here: [comet-photos-v2.0.tar.gz](https://comet-photos-v2.0.tar.gz). This will start copying the file to your browser's download folder. However due to the quantity of photos, this may take some time, so be prepared. Get a cup of coffee, or get some sleep, depending on your Internet speed. When the download completes, move the file to the folder where you want the Comet.Photos directory to reside. Open up a terminal, shell, or cmd window, and navigate to the folder that holds Comet.Photos.tar. If you are on a mac, type: **xattr -d com.apple.quarantine comet-photos-v2.0.tar.gz** to allow your machine to trust the download.

If you haven't done so already, open up a terminal, shell, or cmd window, and navigate to the folder that holds .tar.gz file. Then, no matter what kind of computer you have, run the following command in the terminal to extract the files from the package:
**tar xzf comet-photos-v2.0.tar.gz**
This may take up to 10 minutes as there are plenty of files to unpack. After the tar command finishes up, Comet.Photos will be installed in the new Comet.Photos folder, and you can delete the .tar.gz file to free up space.

Congratulations! You have now installed Comet.Photos. Advance to the Starting Comet.Photos section to learn how to start up the app.

### Installation from Github (more steps)

1. Install Node.js

Node.js is a popular JavaScript runtime required by Comet.Photos, which can be downloaded from https://nodejs.org/. You can simply install the LTS version from the home page, and if prompted, there is no need to install any extras.

2. Fetch the Comet.Photos release from Github.

Get a copy of the release from the Comet.Photos repository (Explanation here)

3. Extract the files from the .zip or .tar.gz

If you are installing from Github, we should know how to unpack the archive onto your local computer.

4. Install the dependencies.

Go into the top level folder (Comet.Photos), and type: **npm install**

5. Download and install the data folder contents

The dataset is too large to include in Github, so it needs to be downloaded and unpacked as an additional step. Download the packed data set by clicking here [comet-photos-data-v2.0.tar.gz](https://comet-photos-data-v2.0.tar.gz). Again, this is close to 14GB, so it may take some time. Don't fret - it will be worth it! Move this file to your Comet.Photos directory if it is not there already. Open up a terminal, shell, or cmd window, and navigate to the folder that holds this .tar.gz file. If you are on a mac, type: **xattr -d com.apple.quarantine comet-photos-data-v2.0.tar.gz** to allow your machine to trust the download.

If you haven't done so already, open up a terminal, shell, or cmd window, and navigate to the folder that holds .tar.gz file. Then, no matter what kind of computer you have, run the following command in the terminal to extract the files from the package:
**tar xzf comet-photos-data-v2.0.tar.gz**
This may take up to 10 minutes as there are plenty of files to unpack. After the tar command finishes up, Comet.Photos should be completely installed, and you can move on to the next step, starting Comet.Photos.

### Starting Comet.Photos

As mentioned before, you can always start a web-based session with Comet.Photos by simply navigating to https://comet.photos. However, if you have installed Comet.Photos locally, simply run one of these scripts from the Comet.Photos directory:

On Windows: **RUN_ME_ON_WINDOWS.cmd**
On macOS: **RUN_ME_ON_MAC.command**
On Linux: **RUN_ME_ON_LINUX.sh**

This should open up a browser on your machine and connect it to your own personal comet.photos server running locally. If you have any difficulties, email info@comet.photos, and we'll try to help.


## Motivation

Introduction goes here.

## User Manual

User Manual goes here

## Step-by-Step Example

Step-by-Step Example goes here


## Architecture

Architecture discussion goes here

## Performance 

Performance goes here

## Acknowledgments

Acknowledgments go here.

## How to Report Issues

This is how to report issues...

[Comet.Photos website]: https://comet.photos/
