import os
import shutil
import sys
import subprocess
import re
import json
import datetime

fromdir = "~/cometdata/CAM"
origBase = "CAM"
newBase = "JSON"
toDir = "~/cometdata/JSON"
cubBase = "CUBS"

def getDict(string):            # parse the string into a dictionary
    result = {}
    for line in string.split('\n'):
        if '=' in line:
            key, val = line.split('=')
            result[key.strip()] = val.strip()
    return result

def parseCoordinate(string): # takes "(x, y, z) <km>" and returns [x, y, z]
     trimStr = string.split(' <')[0]           # removing trailing " <..."
     splitStr = trimStr.strip('()').split(', ')  # ["x" "y" "z"]    
     return [float(i) for i in splitStr]

def parseFloat(string): # takes "float <km>" and returns float (as a float)
    trimStr = string.split(' <')[0]
    return float(trimStr)

def getRes(filename):
    # Check cub file for resolution info
    filename = filename.replace(origBase, cubBase)
    filename = filename[:-4] + '.cub'  # remove the .cam and replace with cub

    with open(filename, 'r') as file:
        for line in file:
            match = re.match(r'\s*Samples\s*=\s*(\d+)\s*', line)
            if match:
                return int(match.group(1))
  
    return None


def parseCamFile(filename):
    # First check that this is the expected resolution...
    if (getRes(filename) != 2048): return None

    result = {}
    with open(filename, 'r') as f:
        data = f.read()

    data = re.sub(',\n\s*', ', ', data)  # replace all comma-newline-whitespace with comma-space for multiline vertices
    blocks = data.split('End_Group', 1)
    if len(blocks) != 2 or blocks[1].strip() == "":
        return None
    
    dict2 = getDict(blocks[0])  # flip the order to make cometView upVec calculation happy - don't want 1024,1024 as v1!
    dict1 = getDict(blocks[1])
  
    result['sc'] = parseCoordinate(dict1['SpacecraftPosition'])
    result['su'] = parseCoordinate(dict1['SunPosition'])
    result["ti"] = dict1["UTC"]
    result["m2"] = round(parseFloat(dict1["SampleResolution"]), 2)
    if (result["m2"] > 10):      # throw away m2's > 10
        return None
    # Use filename below rather than dict1['Filename'] because latter may be hyphenated!
    result["nm"] = os.path.split(filename)[1][:-4] # just include the basename. 
    result['v1'] = parseCoordinate(dict1['LookDirectionBodyFixed'])
    result['v2'] = parseCoordinate(dict2['LookDirectionBodyFixed'])
    result['s1'] = [int(float(dict1['Sample'])), int(float(dict1['Line']))]
    result['s2'] = [int(float(dict2['Sample'])), int(float(dict2['Line']))]

    if ((result['s1'][0] == result['s2'][0]) and (result['s1'][1] == result['s2'][1])):
        print("Bad basis: s1 == s2 for " + filename)
        return None     # return None if s1 == s2 (which can happen in rare circumstances)

    return result
 

print("Starting the directory walk!!!")

# Traverse the source directory tree

filesDone = 0
filesIncluded = 0
viewArray = []

for root, dirs, files in os.walk(fromdir):
    newRoot = root.replace(origBase, newBase, 1)
    if not os.path.exists(newRoot):
       os.makedirs(newRoot)
       print(f"Creating directory: {newRoot}", flush=True)
    # Loop over the files
    for file in files:
        if file.endswith(".cam"):
            # Get the full path of the source file
            src_file = os.path.join(root, file)
            # Get the full path of the destination file
            dst_file = os.path.join(newRoot, file)
            dst_file = dst_file[:-4] + '.json'  # remove the .cam and replace with .json 

            # print(f"Processing: {src_file} ")
            viewData = parseCamFile(src_file)
            if viewData != None:
                viewArray.append(viewData)
                filesIncluded += 1
            # print("RESULT ***** is " + str(json))
            # result = writeJsonFile(dst_file)
            filesDone += 1
            print(f"Finished {filesDone}, JSON Length: {filesIncluded}", flush=True)

# following line sorts array according to ISO standard time format. Thanks, GPT. Needed to remove last digit of fractional second to make it ISO for sorting
viewArray = sorted(viewArray, key=lambda x: datetime.datetime.strptime(x["ti"][:-1], '%Y-%m-%dT%H:%M:%S.%f'))
print(f"Size of final jsonArray is {len(viewArray)}")
print(f"Size in bytes is {sys.getsizeof(viewArray)}")
with open('viewdata.json', 'w') as f:
    f.write(json.dumps(viewArray))


