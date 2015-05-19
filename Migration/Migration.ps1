Add-PSSnapin Microsoft.SharePoint.PowerShell -ErrorAction SilentlyContinue

# Function to Upload File
function UploadFile($WebURL, $DocLibName, $FilePath)
{
	# Get the SharePoint Web & Lists to upload the file
	$Web = Get-SPWeb $WebURL
	$List = $Web.GetFolder($DocLibName)
	
	# Get the Files collection from SharePoint Document Library
	$Files = $List.Files
	
	# Get File Name from Path
	$FileName = $FilePath.Substring($FilePath.LastIndexOf("\")+1)
	
	# Get the File from Disk
	$File= Get-ChildItem $FilePath
	
	# Set the Metadata
	$Metadata = @{}
	$Metadata.add("Account reference", "123456")
	
	# Add File to Files collection of Document Library
	$Files.Add($DocLibName +"/" + $FileName,$File.OpenRead(), $Metadata,  $true) #true for overwrite file, if already exists!
}

# Call the upload function
UploadFile "http://Spaniel/","DropOffLibrary" "C:\Users\rowed1\Desktop\regex.txt"

# Read more: http://www.sharepointdiary.com/2012/07/upload-file-to-sharepoint-library-using-powershell.html#ixzz3aZeS3Bi9