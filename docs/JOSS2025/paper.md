---
title: 'Comet.Photos: An Interactive Tool for Rapidly Searching and Displaying Rosetta Mission Images by Spatial Location and Other Properties'
tags:
  - Rosetta
  - astronomy
  - comets
  - spatial search
  - OSIRIS camera
authors:
  - name: Daniel A. Kurlander
    orcid: 0009-0009-6828-3266
#    equal-contrib: true
    affiliation: 1
  - name: Jason M. Soderblom
    orcid: 0000-0003-3715-6407
#    equal-contrib: true
    affiliation: 1
  - name: Abhinav S. Jindal
    orcid: 0000-0002-1158-3446
#   equal-contrib: true
    affiliation: 2
  - name: David J. Kurlander
    orcid: 0009-0008-9551-7243
#    equal-contrib: true
    affiliation: 3
#    corresponding: true
  - name: Jordan K. Steckloff
    orcid: 0000-0002-1717-2226
    affiliation: 4
  - name: Samuel P. D. Birch
    orcid: 0000-0002-4578-1694
#    equal-contrib: true
    affiliation: 2

affiliations:
 - name: Department of Earth, Atmospheric and Planetary Sciences, Massachusetts Institute of Technology, United States
   index: 1
   ror: 042nb2s44
 - name: Department of Earth, Environmental and Planetary Sciences, Brown University, United States
   index: 2
   ror: 05gq02987
 - name: Independent Researcher, Seattle, Washington, United States
   index: 3
 - name: Planetary Science Institute, United States
   index: 4
   ror: 05vvg9554
date: 28 September 2025
bibliography: paper.bib

# Optional fields if submitting to a AAS journal too, see this blog post:
# https://blog.joss.theoj.org/2018/12/a-new-collaboration-with-aas-publishing
# aas-doi: 10.3847/xxxxx <- update this with the DOI from AAS once you know it.
# aas-journal: Astrophysical Journal <- The name of the AAS journal.
---

# Summary

The European Space Agency’s Rosetta mission to Comet 67P/Churyumov-Gerasimenko (hereafter, 67P) provided an unparalleled dataset that has fully reshaped our understanding of comets. Despite these significant strides, the complexity and volume of Rosetta’s data, coupled with the lack of efficient tools for comprehensive analyses, have hindered its broader utilization. To address this
shortcoming, we have built `Comet.Photos`, an interactive tool that enables highly efficient searching, visualizing, and handling of images of irregular bodies.

`Comet.Photos` enables fast, intuitive spatial searches of the over 44,000 images with the highest level of surface detail taken by the Rosetta spacecraft’s OSIRIS Narrow Angle Camera and Wide Angle Camera [@keller2007], as well as the Rosetta NAVCAM (CITE!). Users select a region of interest on a 3D model of the comet [@preusker2017] by painting with a virtual brush (Figure 1a). The application then seemingly instantly (~ 50 ms) returns a time-ordered list of images containing that region. Images can be filtered by resolution and viewing geometry (emission, incidence, and phase angles), and displayed in either their original 2D form (Figure 1b) or projected onto the 3D surface (Figure 1c).

Designed for professional researchers and the public alike, `Comet.Photos` can be installed locally for fastest performance, but is also accessible in any modern browser without requiring installation. It combines preprocessed data with real-time client-side filtering to enable sub-second search performance, even on large datasets.

# Statement of need

The ESA's Rosetta mission to 67P provided the most spatially and temporally comprehensive dataset of a comet to date. This extensive dataset enables a diverse range of analyses for regions of interest on the comet. Multiple images of the same area can be leveraged for photometric studies [@oklay2016; @fornasier2023], used to derive estimates of the local topography through techniques like photoclinometry [@jindal2024], or examined over time to track surface evolution and understand how cometary landscapes change [@barrington2023; @jindal2022; @birch2019; @elmaary2017; @fornasier2017; @keller2017; @groussin2015]. However, the sheer size of the dataset makes finding images of the same regions a challenge. This difficulty is further compounded by 67P’s complex, highly non-spherical shape, as well as Rosetta’s variable orbit around 67P, which often results in images of the same region appearing vastly different from one another. 

This is exemplified by the fact that it took seven years post-Rosetta for the first global catalog of changes on 67P to be published [@barrington2023]. This required the monumental task of manually sifting through >20,000 OSIRIS NAC images to compile a catalog of images that exhibited surface changes, which took over a year. This was followed by an additional year for
detailed characterization, involving manual map projection of each image with the ShapeViewer software [@vincent2018shapeviewer] and then mapping changes in ESRI’s ArcGIS software. Due to variable imaging geometries, errors naturally arose in identifying images and detecting all the surface changes. Consequently,
despite these efforts, the global change catalog – and, by extension, our understanding of 67P’s evolution – knowingly remains incomplete, with many hundreds of changes likely still undocumented.

Efforts have been made to mitigate these challenges — for example, ESA has introduced an image search capability within the PSA [@esa2024psa]. However, this tool remains inadequate (at least for Rosetta), as it (a) is still slow, (b) frequently returns incorrect data, and (c) lacks user control over filtering searches by image parameters, a crucial feature for assembling a manageable dataset without wasting time removing irrelevant images. Hence, to fully harness the scientific potential of Rosetta’s vast dataset and empower researchers to quickly and accurately identify relevant observations for analysis, an efficient and intuitive tool is needed to streamline image retrieval. 

`Comet.Photos` has been developed to fill this critical gap, providing a powerful solution for spatially targeted image searches and facilitating detailed studies of cometary surface evolution. Users can choose a region of interest by interactively selecting the desired region on a 3D model of 67P. In a fraction of a second, the application searches through over 44,000 images to find only those that feature the selected region. In addition to this spatial search filter, `Comet.Photos` allows users to filter images based on their viewing geometry. To retrieve only the most detailed images, users can filter by spatial resolution, representing the linear scale of a pixel on the surface. Three other parameters of interest from a photometric and surface standpoint are the emission angle (the angle between the camera and surface normal), incidence angle (the angle between the Sun and the surface normal), and phase angle (the solid angle between the Sun and camera at the surface). All three of these can be filtered as well. Images matching the search criteria can be displayed in the application, either in their original 2D form or projected onto the 3D model. At the end of a session with `Comet.Photos`, a list containing the IDs of the filtered images can also be downloaded, allowing further analysis with external tools.

Although designed for scientists, `Comet.Photos` is also a very user-friendly way for astronomy instructors, students, or anyone interested in the solar system to explore Rosetta's extraordinary images of 67P. In making the tool freely available, rapid, and simple-to-use, we aim to open up Rosetta’s rich dataset to the broader scientific community,
bringing in new scientists with fresh perspectives and innovative ideas that will more fully realize Rosetta’s scientific promise and capitalize on the unique insights it provided.Scientists expecting to make frequent use of `Comet.Photos` will want to install it locally, as then all functions, including search and image display, seem instantaneous. People casually interested in the program can access it on the web, requiring absolutely no software installation, simply by visiting [https://comet.photos](https://comet.photos).

# Additional information

`Comet.Photos` achieves its speed through extensive
pre-processing of image metadata. During this pre-processing, for each image, we simulate the spacecraft camera and its relative location to the comet's 3D shape model to detemine which of the model's vertices would have been visible. These vertices are saved in a table, and at runtime fast bit-wise operations allow us to quickly determine the percentage of the region of interest (painted vertices) that would have been visible. Additional image metadata pre-computed for each image, such as the Sun's and spacecraft's position, and resolution allows us to quickly filter through images according to photometric and surface relationships with minimal computation.

To support efficient processing when installed locally, but to also allow remote access on the web, `Comet.Photos` is built with a client-server architecture. The client is implemented as a set of object-based modules (Filter Engine, 3D Scene Manager, Image Browser, GUI Controller, etc...) that communicate via events. The user interface is specified via a declarative schema, and is entirely separate from the controller (filter engine) and the model. The event-driven run-time architecture provides the basis for a logging system with regression tests. The server is a small, modular node.js application with components for launching the browser when run locally, loading the platform-specific C library for rapidly checking visibility tables, and distinct modules that separate preprocessing and run-time event handling. The datasets are separate from the code, and are loaded dynamically from a dataset catalog. With the appropriate preprocessing, 
datasets from other Rosetta instruments, like VIRTIS [@coradini2007], MIRO [@gulkis2007], and ALICE [@stern2007] or even other small solar system body missions, like Lucy [@levison2021], Hera [@michel2022], OSIRIS-REx [@lauretta2017], and OSIRIS-APEX [dellagiustina2023] could be built, and operated upon by `Comet.Photos` as well.

The `Comet.Photos` GitHub repository [@kurlander2025github] includes the source code, as well as a [user manual](https://github.com/comet-dot-photos/comet-dot-photos#user-manual), a [step-by-step example](https://github.com/comet-dot-photos/comet-dot-photos#step-by-step-example) of the program's use, [instructions for installing the program locally](https://github.com/comet-dot-photos/comet-dot-photos#installation) and [testing the installation](https://github.com/comet-dot-photos/comet-dot-photos#testing-the-installation), a description of [the design, architecture, and implementation](https://github.com/comet-dot-photos/comet-dot-photos#design-architecture-and-implementation), and information on [program performance](https://github.com/comet-dot-photos/comet-dot-photos#performance).

# Acknowledgements

This research was supported by the NASA Discovery Data Analysis Program (grant 80NSSC22K1399 supported D.A.K., J.M.S., and J.K.S., and grant 80NSSC24K0060 supported A.S.J. and S.P.D.B.). We gratefully acknowledge Jean-Baptiste Vincent, discussions with whom made this software possible as he helped us navigate Rosetta’s dataset. A 2023 MIT Open Data Prize for an earlier version
of this work also provided recognition and encouragement to continue developing IRIS `Comet.Photos`[@fay2023opendata]. Lastly, we thank all of the early users of the program for feedback that led to improvements.

# References